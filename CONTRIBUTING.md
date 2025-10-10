# 🤝 Contributing to Discord Letta Bot

First off, thank you for considering contributing! It's people like you that make this bot better for everyone.

## 🌟 How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples**
- **Describe the behavior you observed and what you expected**
- **Include logs** (sanitize any tokens/IDs!)
- **Environment details** (Node.js version, OS, etc.)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear and descriptive title**
- **Provide a step-by-step description** of the suggested enhancement
- **Explain why this enhancement would be useful**
- **List examples** of other projects where this feature exists

### Pull Requests

1. **Fork the repository**
2. **Create a new branch** (`git checkout -b feature/amazing-feature`)
3. **Make your changes**
4. **Test thoroughly**
5. **Commit your changes** (`git commit -m 'Add amazing feature'`)
6. **Push to the branch** (`git push origin feature/amazing-feature`)
7. **Open a Pull Request**

## 📝 Development Setup

```bash
# Clone your fork
git clone https://github.com/yourusername/discord-letta-bot.git
cd discord-letta-bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Fill in your test credentials

# Build TypeScript
npm run build

# Start development
npm run dev
```

## 🧪 Testing

Before submitting a PR:

1. **Build succeeds**: `npm run build`
2. **Bot starts**: `npm start`
3. **Test core features**:
   - Send a message → Bot responds
   - Send an image → Bot processes it
   - Create a task → Task executes
4. **Check logs** for errors
5. **Test edge cases**

## 💻 Code Style

We follow these conventions:

### TypeScript
- Use TypeScript for all new code
- Proper type annotations (avoid `any` when possible)
- Use `const` over `let` when appropriate
- Async/await over `.then()`

### Formatting
- Indentation: 2 spaces
- Line length: ~100 characters
- Semicolons: Yes
- Trailing commas: Yes in arrays/objects

### Naming
- Functions: `camelCase`
- Classes: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Files: `camelCase.ts`

### Comments
- Explain **why**, not what
- JSDoc for public functions
- TODO comments with context

### Example:

```typescript
/**
 * Compresses an image buffer using adaptive quality settings.
 * @param buffer - Original image buffer
 * @param targetSize - Target size in bytes
 * @returns Compressed buffer or null if compression failed
 */
async function compressImage(
  buffer: Buffer, 
  targetSize: number
): Promise<Buffer | null> {
  // Try WebP first as it usually has better compression
  const sharpMod = await loadSharp();
  if (!sharpMod) return null;
  
  // ... implementation
}
```

## 🔒 Security

### Reporting Vulnerabilities

**DO NOT** open a public issue for security vulnerabilities!

Instead:
1. Email the maintainers (if available in README)
2. Open a GitHub Security Advisory
3. Include detailed steps to reproduce

### Security Best Practices

- **Never commit secrets** (tokens, API keys, passwords)
- **Validate all input** from Discord and external sources
- **Sanitize user data** before logging
- **Use environment variables** for configuration
- **Follow principle of least privilege**

## 📚 Documentation

Good documentation is crucial:

- **Update README.md** if you change functionality
- **Add JSDoc comments** for public APIs
- **Create examples** for new features
- **Update LETTA_TOOLS.md** if you add/change tools
- **Keep .env.example up to date**

## 🎯 Priority Areas

We especially welcome contributions in:

- 🐛 **Bug fixes** - Always appreciated!
- 📖 **Documentation** - Can never have too much
- 🧪 **Tests** - Help us test more scenarios
- ♿ **Accessibility** - Make the bot work for everyone
- 🌍 **Internationalization** - Multi-language support
- 🚀 **Performance** - Optimization is always good

## 🤔 Questions?

Don't hesitate to ask questions:

- Open an issue with the label `question`
- Check existing issues for similar questions
- Read the docs thoroughly first

## 📜 Code of Conduct

### Our Pledge

We pledge to make participation in our project a harassment-free experience for everyone, regardless of:

- Age
- Body size
- Disability
- Ethnicity
- Gender identity and expression
- Level of experience
- Nationality
- Personal appearance
- Race
- Religion
- Sexual identity and orientation

### Our Standards

**Positive behavior:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

**Unacceptable behavior:**
- Trolling, insulting/derogatory comments
- Public or private harassment
- Publishing others' private information
- Other conduct which could reasonably be considered inappropriate

### Enforcement

Project maintainers have the right to:
- Remove, edit, or reject comments/commits/code/issues
- Ban temporarily or permanently any contributor for behaviors deemed inappropriate

## 🎉 Recognition

Contributors will be:
- Listed in README.md (if desired)
- Thanked in release notes
- Given credit in commit history

---

**Thank you for contributing!** 🙏

Every contribution, no matter how small, makes a difference. Whether it's:
- Fixing a typo in documentation
- Reporting a bug
- Adding a feature
- Helping other users

We appreciate you! ❤️

