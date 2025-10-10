# AttachmentForwarder - Test Plan & Security Checks

## 🔒 Security Tests

### Test 1: SSRF Protection (Server-Side Request Forgery)
**Purpose**: Ensure only Discord CDN URLs are processed

**Test Cases**:
```
✅ PASS: https://cdn.discordapp.com/attachments/123/image.png
✅ PASS: https://media.discordapp.net/attachments/456/photo.jpg
❌ REJECT: http://cdn.discordapp.com/... (non-HTTPS)
❌ REJECT: https://evil.com/image.png (untrusted domain)
❌ REJECT: https://localhost/ssrf-test.png (localhost)
❌ REJECT: https://169.254.169.254/metadata (AWS metadata endpoint)
```

**Expected Behavior**: 
- Only HTTPS URLs from Discord CDN domains are processed
- Rejected URLs are logged with security warning
- User receives no error message (silent drop for security)

---

### Test 2: Rate Limiting
**Purpose**: Prevent spam and DoS attacks

**Test Cases**:
```
1. User sends image #1 → ✅ Processed
2. User sends image #2 within 3 seconds → ⏳ Rate limited, reacts with ⏳
3. Wait 3+ seconds → ✅ Can send again
```

**Expected Behavior**:
- Max 1 request per user per 3 seconds
- Rate-limited requests get ⏳ reaction
- Rate limit cache clears after 10 seconds
- No memory leak in processingUsers Map

---

### Test 3: Input Validation
**Purpose**: Prevent malicious payloads

**Test Cases**:
```
✅ Normal image: 2MB JPEG
✅ Large image: 24MB PNG (should compress)
❌ Oversized: 50MB (exceeds MAX_IMAGE_DOWNLOAD_SIZE)
✅ Multiple images: 3x 5MB images
✅ Empty content-type header (fallback to image/jpeg)
❌ Invalid URL format: "not-a-url"
```

**Expected Behavior**:
- Invalid URLs are caught and logged
- Oversized downloads fail gracefully with axios error
- User gets informative error message

---

## 🐛 Bug Tests

### Test 1: Happy Path
**Scenario**: User sends single 1MB image with text

**Steps**:
1. Send message: "Look at this!" + 1MB image
2. Bot shows typing indicator
3. Image forwarded to Letta via URL
4. Bot replies with AI response

**Expected Result**: ✅ Success, no errors

---

### Test 2: Edge Case - Large Images
**Scenario**: User sends 15MB image

**Steps**:
1. Send 15MB PNG image
2. URL upload fails (too large)
3. Bot downloads and compresses image
4. Compression loop: WEBP → JPEG → reduce size
5. Final size < 4MB
6. Upload via base64

**Expected Result**: 
- ✅ Image compressed successfully
- User sees: "(🗜️ compressed 1 image to fit size limits)"

---

### Test 3: Edge Case - Multiple Images
**Scenario**: User sends 4 images at once

**Steps**:
1. Send 4 images: 8MB, 2MB, 20MB, 1MB
2. Process each sequentially
3. Compress 8MB and 20MB images
4. Send all as base64

**Expected Result**:
- ✅ All processable images sent
- User sees: "(🗜️ compressed 2 images to fit size limits)"

---

### Test 4: Break Attempt - Network Timeout
**Scenario**: Discord CDN is slow/unavailable

**Steps**:
1. Send image with slow network
2. axios.get() times out after 20s
3. Download fails, returns null
4. Image skipped

**Expected Result**:
- ❌ Error logged: "[Download] Failed to download image"
- User sees: "❌ Couldn't process the image(s): all images were too large or failed to download."

---

### Test 5: Break Attempt - Sharp Not Available
**Scenario**: sharp module not installed

**Steps**:
1. Send 10MB image
2. URL upload fails
3. Attempts to compress
4. loadSharp() returns null
5. Image skipped

**Expected Result**:
- ⚠️ Warning: "sharp not available; cannot compress"
- User sees: "⚠️ skipped 1 oversized image"

---

### Test 6: Memory Leak Check
**Scenario**: Send 10 large images in sequence

**Steps**:
1. Send image → process → complete
2. Check memory usage
3. Repeat 10 times

**Expected Result**:
- Memory usage stays constant
- Buffers are nulled after use (line 346)
- typingInterval always cleared in finally block
- processingUsers Map cleans up after 10s

**How to Verify**:
```bash
# Monitor Node.js memory
ps aux | grep node
# Or use Node.js profiler
node --inspect server.js
```

---

## 🔥 Stress Tests

### Test 7: Concurrent Users
**Scenario**: 5 users send images simultaneously

**Expected Behavior**:
- Each user has own rate limit
- No race conditions with typingInterval
- All requests handled independently
- No memory leaks

---

### Test 8: Letta API Failure
**Scenario**: Letta API returns 500 error

**Steps**:
1. Send image
2. Both URL and base64 uploads fail
3. Error is caught and logged

**Expected Result**:
- Error logged with full details
- User sees: "❌ Couldn't process the image. Please try again later."

---

## 📊 Performance Benchmarks

| Scenario | Expected Time | Memory Usage |
|----------|---------------|--------------|
| Small image (1MB) via URL | < 2s | ~50MB |
| Large image (10MB) with compression | 5-10s | ~100MB |
| 4 images with compression | 15-20s | ~150MB |

---

## 🛡️ Security Checklist

- [x] SSRF protection with domain whitelist
- [x] HTTPS-only enforcement
- [x] Rate limiting per user
- [x] Input validation on all URLs
- [x] Proper error handling (no stack traces to user)
- [x] Memory cleanup after processing
- [x] Timeout protection on network requests
- [x] No eval() or dangerous code execution
- [x] Env vars validated before use
- [x] No SQL injection vectors (no DB used)

---

## 🔄 Regression Tests

After any code changes, verify:

1. **Backward compatibility**: Old image URLs still work
2. **Error messages**: User-friendly, no technical jargon
3. **Logging**: All errors logged with context
4. **Typing indicator**: Always stops (no infinite typing)
5. **Rate limit cleanup**: No memory leak in Map

---

## 🚀 Manual Testing Checklist

Before deployment:

- [ ] Test with 1 small image
- [ ] Test with 1 large image (>4MB)
- [ ] Test with multiple images
- [ ] Test with non-image attachment
- [ ] Test with no text + image
- [ ] Test with text + image
- [ ] Test rate limiting (send 2 images quickly)
- [ ] Monitor logs for errors
- [ ] Check memory usage after 10 requests
- [ ] Verify typing indicator stops

---

## 📝 Notes

### Known Limitations
1. Max image size: ~25MB (hard limit by Discord)
2. Compression requires `sharp` module
3. Rate limit: 1 request per 3s per user
4. Sequential processing (not parallel) to avoid memory spikes

### Future Improvements
- [ ] Add Prometheus metrics
- [ ] Implement retry with exponential backoff
- [ ] Add image format validation (SVG injection protection)
- [ ] Cache compressed images temporarily
- [ ] Support for animated GIFs/videos

