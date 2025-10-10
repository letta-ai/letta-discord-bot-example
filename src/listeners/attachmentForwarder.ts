import { Client, Events } from "discord.js";
import { LettaClient } from "@letta-ai/letta-client";
import axios from "axios";

// ===== SECURITY & PERFORMANCE CONFIGS =====
const ALLOWED_IMAGE_DOMAINS = [
  'cdn.discordapp.com',
  'media.discordapp.net',
  'images.discordapp.net'
];
const MAX_IMAGES_PER_MESSAGE = 10; // Discord's limit
const MAX_IMAGE_DOWNLOAD_SIZE = 25 * 1024 * 1024; // 25MB
const REQUEST_TIMEOUT = 20000; // 20s
const SAFE_TARGET_BYTES = 4 * 1024 * 1024; // 4MB safe target
const MAX_BYTES = 5 * 1024 * 1024; // 5MB absolute limit

// CRITICAL: Letta API has 2000px dimension limit for multi-image requests!
const LETTA_MAX_DIMENSION = 2000; // px - any dimension exceeding this will cause 400 error

// Rate limiting map: userId -> timestamp
const processingUsers = new Map<string, number>();

// sharp is optional; load dynamically to avoid native install issues where unavailable
async function loadSharp(): Promise<any | null> {
  try {
    const mod: any = await import('sharp');
    return mod?.default ?? mod;
  } catch (err) {
    console.warn('[Sharp] Failed to load sharp module:', err instanceof Error ? err.message : err);
    return null;
  }
}

function createSharpPipeline(sharpMod: any, input: Buffer): any | null {
  try {
    return sharpMod ? sharpMod(input) : null;
  } catch (err) {
    console.error('[Sharp] Failed to create pipeline:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Security: Validate Discord CDN URLs to prevent SSRF attacks
function validateImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow HTTPS
    if (parsed.protocol !== 'https:') {
      console.warn(`[Security] Rejected non-HTTPS URL: ${url}`);
      return false;
    }
    // Check if domain is in allowed list
    const isAllowed = ALLOWED_IMAGE_DOMAINS.some(domain => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain));
    if (!isAllowed) {
      console.warn(`[Security] Rejected URL from untrusted domain: ${parsed.hostname}`);
    }
    return isAllowed;
  } catch (err) {
    console.error('[Security] Invalid URL format:', url, err instanceof Error ? err.message : err);
    return false;
  }
}

function extractAssistantText(ns: any): string {
  try {
    let out = '';
    const arr = (ns && (ns.messages || ns.data)) || [];
    if (Array.isArray(arr)) {
      for (const m of arr) {
        const type = (m && (m.messageType || m.message_type || m.role));
        if (type === 'assistant_message' || type === 'assistant') {
          const c = m.content;
          if (Array.isArray(c)) {
            for (const p of c) {
              if (p && p.type === 'text' && typeof p.text === 'string') {
                out += p.text;
              }
            }
          } else if (c && typeof c === 'object' && typeof c.text === 'string') {
            out += c.text;
          } else if (typeof c === 'string') {
            out += c;
          }
        }
      }
    }
    if (!out && typeof ns?.content === 'string') return ns.content;
    return out;
  } catch { return ''; }
}

/**
 * Registers a listener that forwards image attachments to Letta Cloud
 * and replies with the agent response in the same thread.
 */
export function registerAttachmentForwarder(client: Client) {
  console.log('📦 AttachmentForwarder loaded (with typing + compression + multi-image + security)');
  
  client.on(Events.MessageCreate, async (msg) => {
    // Ignore bot messages
    if (msg.author.bot) return;

    // No attachments? skip
    if (!msg.attachments?.size) return;

    // Collect and validate image URLs
    const urls: string[] = [];
    let rejectedUrls = 0;
    
    for (const [, att] of msg.attachments) {
      const ct = (att as any).contentType || (att as any).content_type || '';
      const url = (att as any).url || (att as any).proxyURL;
      if (ct && typeof ct === 'string' && ct.startsWith('image/') && url) {
        const urlStr = String(url);
        // Security: validate URL before processing
        if (validateImageUrl(urlStr)) {
          urls.push(urlStr);
        } else {
          console.warn(`[Security] Skipped invalid image URL from user ${msg.author.id}`);
          rejectedUrls++;
        }
      }
    }
    
    if (urls.length === 0) {
      // Inform user if images were rejected
      if (rejectedUrls > 0) {
        try {
          await msg.reply("❌ Invalid image sources (only Discord CDN links allowed for security).");
        } catch (err) {
          console.error('[Discord] Failed to send rejection message:', err instanceof Error ? err.message : err);
        }
      }
      return;
    }
    
    // Discord limit check (max 10 images per message)
    if (urls.length > MAX_IMAGES_PER_MESSAGE) {
      console.warn(`[Limit] User ${msg.author.id} sent ${urls.length} images, limiting to ${MAX_IMAGES_PER_MESSAGE}`);
      try {
        await msg.reply(`⚠️ Too many images (${urls.length}). Processing only the first ${MAX_IMAGES_PER_MESSAGE} images.`);
      } catch (err) {
        console.error('[Discord] Failed to send limit message:', err instanceof Error ? err.message : err);
      }
      urls.splice(MAX_IMAGES_PER_MESSAGE); // Keep only first 10
    }

    // Rate limiting: prevent user from spamming concurrent requests
    const userId = msg.author.id;
    const lastProcessing = processingUsers.get(userId);
    const now = Date.now();
    if (lastProcessing && (now - lastProcessing) < 3000) {
      console.warn(`[RateLimit] User ${userId} is sending images too quickly, ignoring`);
      try {
        await msg.react('⏳');
      } catch (err) {
        console.error('[Discord] Failed to react:', err instanceof Error ? err.message : err);
      }
      return;
    }
    processingUsers.set(userId, now);

    let typingInterval: NodeJS.Timeout | null = null;
    
    try {
      // Show typing while processing
      try {
        await (msg.channel as any).sendTyping();
      } catch (err) {
        console.error('[Discord] Failed to send typing indicator:', err instanceof Error ? err.message : err);
      }
      
      typingInterval = setInterval(() => {
        (msg.channel as any).sendTyping().catch((err: Error) => {
          console.error('[Discord] Typing interval error:', err.message);
        });
      }, 8000);

      const userText = (msg.content || '').trim();
      const reply = await forwardImagesToLetta(urls, userId, userText);
      
      if (reply && reply.trim()) {
        await msg.reply(reply);
      } else {
        console.warn('[Letta] Empty reply received, not sending message');
      }
    } catch (err) {
      console.error("[AttachmentForwarder] Image processing failed:", err instanceof Error ? err.message : err, err);
      
      // Provide helpful error message based on error type
      let userMessage = "❌ Couldn't process image(s).";
      const errMsg = err instanceof Error ? err.message : String(err);
      
      if (errMsg.includes('LETTA_AGENT_ID') || errMsg.includes('LETTA_API_KEY')) {
        userMessage += " (Bot configuration error - please contact admin)";
      } else if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
        userMessage += " (Network timeout - please try again later)";
      } else if (errMsg.includes('ECONNREFUSED') || errMsg.includes('network')) {
        userMessage += " (Connection error - Letta API unreachable)";
      } else if (errMsg.includes('401') || errMsg.includes('403')) {
        userMessage += " (API authentication failed - please contact admin)";
      } else if (errMsg.includes('429')) {
        userMessage += " (Too many requests - please wait 1-2 minutes)";
      } else if (errMsg.includes('5MB') || errMsg.includes('too large')) {
        userMessage += " (Images too large - please use smaller images)";
      } else {
        userMessage += " Please try again later.";
      }
      
      try {
        await msg.reply(userMessage);
      } catch (replyErr) {
        console.error('[Discord] Failed to send error reply:', replyErr instanceof Error ? replyErr.message : replyErr);
      }
    } finally {
      // CRITICAL: Always clear the typing interval to prevent memory leaks
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
      }
      // Clean up rate limit after a delay
      setTimeout(() => processingUsers.delete(userId), 10000);
    }
  });
}

// Helper: Download and validate image with proper error handling
async function downloadImage(url: string, index: number, total: number): Promise<{ buffer: Buffer; mediaType: string } | null> {
  try {
    const res = await axios.get(url, { 
      responseType: 'arraybuffer', 
      timeout: REQUEST_TIMEOUT, 
      maxContentLength: MAX_IMAGE_DOWNLOAD_SIZE,
      validateStatus: (status) => status === 200
    });
    
    const mediaType = (res.headers['content-type'] as string) || 'image/jpeg';
    const buffer = Buffer.from(res.data);
    
    console.log(`📥 [${index + 1}/${total}] Downloaded: ${Math.round(buffer.length / 1024)}KB, type=${mediaType}`);
    return { buffer, mediaType };
  } catch (err) {
    console.error(`[Download] Failed to download image ${index + 1}/${total}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// Helper: Compress image buffer with adaptive strategy + dimension checking
async function compressImage(buffer: Buffer, mediaType: string, index: number, total: number, forceDimensionCheck: boolean = false): Promise<{ buffer: Buffer; mediaType: string } | null> {
  const sharpMod = await loadSharp();
  if (!sharpMod) {
    console.warn(`⚠️ [${index + 1}/${total}] sharp not available; cannot compress`);
    return null;
  }

  // CRITICAL: Get image metadata to check dimensions
  let metadata;
  try {
    metadata = await createSharpPipeline(sharpMod, buffer)?.metadata();
  } catch (err) {
    console.error(`❌ [${index + 1}/${total}] Failed to read image metadata:`, err instanceof Error ? err.message : err);
    return null;
  }

  const originalWidth = metadata?.width || 0;
  const originalHeight = metadata?.height || 0;
  const exceedsDimensions = originalWidth > LETTA_MAX_DIMENSION || originalHeight > LETTA_MAX_DIMENSION;

  console.log(`📐 [${index + 1}/${total}] Original: ${originalWidth}x${originalHeight}px, ${Math.round(buffer.length / 1024)}KB`);

  // If dimensions are fine AND size is fine, skip compression
  if (!exceedsDimensions && buffer.length <= SAFE_TARGET_BYTES && !forceDimensionCheck) {
    console.log(`✅ [${index + 1}/${total}] No compression needed`);
    return { buffer, mediaType };
  }

  let buf = buffer;
  // Start with Letta-safe dimensions
  let width = Math.min(LETTA_MAX_DIMENSION, originalWidth);
  let quality = 70;
  let fmt: 'webp' | 'jpeg' = 'webp';
  let attempts = 0;
  const maxAttempts = 10;
  let needsResize = exceedsDimensions; // Track if we still need dimension fixes

  // Compress if size OR dimensions exceed limits
  while ((buf.length > SAFE_TARGET_BYTES || needsResize) && attempts < maxAttempts) {
    const pipeline = createSharpPipeline(sharpMod, buf)?.rotate().resize({ width, withoutEnlargement: true });
    if (!pipeline) {
      console.warn(`⚠️ [${index + 1}/${total}] Failed to create pipeline at attempt ${attempts + 1}`);
      return null;
    }

    try {
      const out = fmt === 'webp'
        ? await pipeline.webp({ quality }).toBuffer()
        : await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
      
      console.log(`🗜️ [${index + 1}/${total}] Attempt ${attempts + 1}: ${fmt} ${width}px q${quality} → ${Math.round(out.length / 1024)}KB`);
      
      buf = out;
      mediaType = fmt === 'webp' ? 'image/webp' : 'image/jpeg';
      
      // After first resize, dimensions are fixed
      if (needsResize && width <= LETTA_MAX_DIMENSION) {
        needsResize = false;
        console.log(`✅ [${index + 1}/${total}] Dimensions now within Letta limit (${width}px)`);
      }

      if (buf.length > SAFE_TARGET_BYTES) {
        // Adaptive compression strategy
        if (quality > 40) {
          quality = Math.max(35, quality - 10);
        } else if (width > 640) {
          width = Math.max(640, Math.floor(width * 0.8));
        } else if (fmt === 'webp') {
          // Switch to JPEG if WEBP isn't helping
          fmt = 'jpeg';
          quality = 55;
          width = Math.min(width, 1024);
        } else {
          quality = Math.max(30, quality - 5);
          width = Math.max(480, Math.floor(width * 0.85));
        }
      }
      attempts++;
    } catch (err) {
      console.error(`[Compress] Compression failed at attempt ${attempts + 1}:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  if (buf.length > SAFE_TARGET_BYTES) {
    console.warn(`⚠️ [${index + 1}/${total}] Still ${Math.round(buf.length / 1024)}KB after ${attempts} attempts`);
    return null;
  }

  console.log(`✅ [${index + 1}/${total}] Compressed to ${Math.round(buf.length / 1024)}KB (${mediaType})`);
  return { buffer: buf, mediaType };
}

async function forwardImagesToLetta(
  urls: string[],
  userId: string,
  userText?: string
): Promise<string> {
  const token = process.env.LETTA_API_KEY || process.env.LETTA_KEY || '';
  const baseUrl = (process.env.LETTA_BASE_URL || process.env.LETTA_API || 'https://api.letta.com').replace(/\/$/, '');
  const agentId = process.env.LETTA_AGENT_ID || process.env.AGENT_ID || '';
  
  if (!agentId || !token) {
    throw new Error("LETTA_AGENT_ID and LETTA_API_KEY (or AGENT_ID/LETTA_KEY) must be set");
  }

  const client = new LettaClient({ token, baseUrl } as any);

  const payloadUrl: any = {
    messages: [
      {
        role: "user",
        content: [
          ...urls.map(u => ({ type: 'image', source: { type: 'url', url: u } })),
          ...(userText && userText.trim() ? [{ type: 'text', text: userText }] : [{ type: 'text', text: `Describe the image sent by user ${userId}.` }])
        ]
      }
    ]
  };
  
  console.log(`🧾 Sending ${urls.length} image(s) via URL, hasText=${!!(userText && userText.trim())}`);

  // Try URL-based upload first (fastest)
  try {
    const ns: any = await (client as any).agents.messages.create(agentId, payloadUrl as any);
    const text = extractAssistantText(ns);
    console.log('✅ URL-based upload successful');
    return text || '';
  } catch (e: any) {
    const status = e?.status || e?.response?.status;
    console.warn(`⚠️ URL upload failed (status=${status}), falling back to base64`);
    
    // Fallback: Download and convert to base64 with compression
    try {
      console.log(`📦 Processing ${urls.length} image(s) for base64 upload...`);
      const base64Images: any[] = [];
      let skippedCount = 0;
      let compressedCount = 0;

      // Process images sequentially to avoid memory spikes
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        
        // Download image
        const downloaded = await downloadImage(url, i, urls.length);
        if (!downloaded) {
          skippedCount++;
          continue;
        }

        let { buffer, mediaType } = downloaded;

        // CRITICAL: For multi-image requests, ALWAYS check dimensions (Letta 2000px limit!)
        const isMultiImage = urls.length > 1;
        const needsCompression = buffer.length > SAFE_TARGET_BYTES || isMultiImage;
        
        if (needsCompression) {
          if (buffer.length > SAFE_TARGET_BYTES) {
            console.log(`🗜️ [${i + 1}/${urls.length}] Image exceeds safe size limit, compressing...`);
          } else {
            console.log(`📐 [${i + 1}/${urls.length}] Checking dimensions for multi-image request...`);
          }
          
          const compressed = await compressImage(buffer, mediaType, i, urls.length, isMultiImage);
          
          if (!compressed) {
            console.warn(`⚠️ [${i + 1}/${urls.length}] Compression/resize failed, skipping image`);
            skippedCount++;
            continue;
          }

          buffer = compressed.buffer;
          mediaType = compressed.mediaType;
          if (compressed.buffer.length !== downloaded.buffer.length || isMultiImage) {
            compressedCount++;
          }
        }

        // Convert to base64 and add to payload
        const base64Data = buffer.toString('base64');
        base64Images.push({ 
          type: 'image', 
          source: { type: 'base64', mediaType, data: base64Data } 
        });

        // CRITICAL: Clear buffer reference to free memory immediately
        buffer = null as any;
      }

      console.log(`📊 Base64 processing complete: ${base64Images.length} images, ${compressedCount} compressed, ${skippedCount} skipped`);

      if (base64Images.length === 0) {
        // Provide specific reason why all images failed
        if (skippedCount === urls.length) {
          const sharpAvailable = await loadSharp();
          if (!sharpAvailable) {
            return "❌ All images too large (>4MB) and compression unavailable.\n💡 Tip: Please resize images first or ask admin to install 'sharp'.";
          } else {
            return "❌ All images failed compression (possibly corrupt files).\n💡 Tip: Please try different or smaller images (<2MB).";
          }
        } else {
          return "❌ All images failed to download (network issue).\n💡 Tip: Please try again later.";
        }
      }

      const payloadB64: any = {
        messages: [
          {
            role: 'user',
            content: [
              ...base64Images,
              ...(userText && userText.trim() 
                ? [{ type: 'text', text: userText }] 
                : [{ type: 'text', text: `Describe the image sent by user ${userId}.` }])
            ]
          }
        ]
      };

      const ns2: any = await (client as any).agents.messages.create(agentId, payloadB64 as any);
      const text2 = extractAssistantText(ns2);

      // Build informative response
      const noteParts: string[] = [];
      if (compressedCount > 0) {
        noteParts.push(`🗜️ ${compressedCount} image${compressedCount === 1 ? '' : 's'} compressed`);
      }
      if (skippedCount > 0) {
        noteParts.push(`⚠️ ${skippedCount} image${skippedCount === 1 ? '' : 's'} skipped (too large)`);
      }
      const note = noteParts.length ? `_(${noteParts.join(', ')})_\n\n` : '';
      
      return (note + (text2 || '')).trim();
    } catch (e2: any) {
      const detail = (e2?.body?.detail || e2?.response?.data || e2?.message || '').toString();
      console.error('[Letta] Base64 upload failed:', e2 instanceof Error ? e2.message : e2);
      
      // Provide specific error messages based on failure type
      if (/exceeds\s*5\s*MB/i.test(detail) || /payload.*large/i.test(detail)) {
        return "❌ Image(s) still too large even after compression (>5MB).\n💡 Tip: Please use smaller images (<2MB recommended).";
      } else if (/401|403|unauthorized/i.test(detail)) {
        return "❌ API authentication failed.\n💡 Please contact admin (API key issue).";
      } else if (/429|rate.?limit/i.test(detail)) {
        return "❌ Too many API requests.\n💡 Please wait 1-2 minutes and try again.";
      } else if (/timeout|ETIMEDOUT/i.test(detail)) {
        return "❌ API timeout - processing took too long.\n💡 Please use smaller images or try later.";
      } else if (/network|ECONNREFUSED|ENOTFOUND/i.test(detail)) {
        return "❌ Letta API unreachable.\n💡 Please try again later or contact admin.";
      }
      
      throw e2;
    }
  }
}
