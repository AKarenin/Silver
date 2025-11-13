# Silver - AI Contextual Layer

Silver is a cross-platform (macOS and Windows) desktop application that provides an AI-native contextual layer for all your computing needs. Capture any region of your screen, annotate it, and interact with AI to get instant insights.

## Features

### Free Features
- **True Overlay Mode**: Works on top of fullscreen apps, just like Raycast or Spotlight
- **Global Screen Capture**: Press `Cmd/Ctrl+Shift+S` to capture any region of your screen
- **Dual Selection Modes**:
  - **Rectangle Mode**: Traditional drag-to-select rectangular regions
  - **Lasso Mode**: Free-form selection by drawing around any shape
- **AI Chat**: Ask questions about your captured screenshots using GPT-4o
- **Background Daemon**: Runs invisibly in the background, always ready when you need it
- **Multi-Workspace Support**: Appears on all desktops and spaces

### Pro Features (Freemium)
- **Annotation Tools**: Draw, add arrows, shapes, and text to your screenshots before sending to AI
- **Factual Search**: Enhance your questions with real-time web search results (Tavily API integration)
- **Advanced AI Analysis**: Get more comprehensive answers with search-augmented generation (RAG)

## Tech Stack

- **Framework**: Electron
- **Language**: TypeScript
- **UI**: React with Vite
- **AI**: OpenAI GPT-4o
- **Web Search**: Tavily Search API (for Pro features)

## Installation

### Prerequisites

- Node.js 18+ and npm
- OpenAI API Key
- (Optional) Tavily API Key for Pro search features

### Required Permissions

#### macOS
On first run, Silver will request the following permissions:

1. **Screen Recording Permission**
   - Go to: System Preferences → Security & Privacy → Privacy → Screen Recording
   - Enable permission for Silver
   - Required to capture screen regions

2. **Accessibility Permission**
   - Go to: System Preferences → Security & Privacy → Privacy → Accessibility
   - Enable permission for Silver
   - Required for global hotkeys to work in all apps, including fullscreen apps

#### Windows
- Administrator privileges may be required for global hotkeys in some cases
- Windows Defender might prompt for permission on first run

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd Silver
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**

   Create a `.env` file in the root directory:
   ```bash
   OPENAI_API_KEY=your_openai_api_key_here
   TAVILY_API_KEY=your_tavily_api_key_here  # Optional, for Pro features
   ```

   Or set them in your system environment variables:

   **macOS/Linux:**
   ```bash
   export OPENAI_API_KEY=your_openai_api_key_here
   export TAVILY_API_KEY=your_tavily_api_key_here
   ```

   **Windows:**
   ```cmd
   set OPENAI_API_KEY=your_openai_api_key_here
   set TAVILY_API_KEY=your_tavily_api_key_here
   ```

## Development

### Run in Development Mode

```bash
npm run electron:dev
```

This will:
1. Start the Vite development server
2. Launch Electron with hot-reload enabled

### Build for Production

```bash
npm run build
```

This compiles both the React app and the Electron main process.

### Package the Application

```bash
npm run package
```

This creates distributable packages for your platform:
- **macOS**: DMG and ZIP files
- **Windows**: NSIS installer and portable executable

## Usage

### Basic Workflow

1. **Start the app**: The app runs as a background daemon (no visible window)

2. **Capture screen**: Press `Cmd+Shift+S` (macOS) or `Ctrl+Shift+S` (Windows)

3. **Choose selection mode**:
   - **▢ Rectangle**: Click and drag to select a rectangular region
   - **○ Lasso**: Draw around any shape for flexible, free-form selection
   - Press `ESC` to cancel selection

4. **Select your region**: Click and drag based on your chosen mode
   - Rectangle mode creates a clean rectangular boundary
   - Lasso mode follows your mouse path and calculates the bounding box

5. **Choose interaction mode**:
   - **💬 Chat (Free)**: Ask questions about the captured region
   - **✏️ Annotate (Pro)**: Add drawings, arrows, shapes, or text to highlight important areas
   - **🔍 Factual Search (Pro)**: Get AI answers enhanced with real-time web search results

6. **Ask your question**: Type your question and press Send

7. **Get AI response**: The AI analyzes your screenshot and provides detailed answers

### Example Use Cases

- **Code Review**: Capture code snippets and ask for explanations or improvements
- **Design Feedback**: Capture UI mockups and get design suggestions
- **Technical Support**: Capture error messages and get troubleshooting help
- **Research**: Capture diagrams or charts and ask for analysis
- **Documentation**: Capture complex interfaces and get step-by-step guides
- **Data Analysis**: Capture graphs or tables and ask for insights

## Architecture

### File Structure

```
Silver/
├── electron/
│   ├── main.ts          # Electron main process (window management, IPC, screen capture)
│   └── preload.ts       # Context bridge (secure IPC communication)
├── src/
│   ├── components/
│   │   ├── CaptureWindow.tsx      # Full-screen selection overlay
│   │   ├── ChatWindow.tsx         # Main chat interface
│   │   └── AnnotationCanvas.tsx   # Pro annotation tools
│   ├── App.tsx          # Main React component (window routing)
│   ├── main.tsx         # React entry point
│   └── index.css        # Global styles
├── index.html           # HTML entry point
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript config for React
├── tsconfig.electron.json  # TypeScript config for Electron
└── vite.config.ts       # Vite bundler config
```

### Key Components

#### electron/main.ts
- Registers global hotkey (`Cmd/Ctrl+Shift+S`)
- Creates and manages windows (CaptureWindow and ChatWindow)
- Configures true overlay mode for fullscreen compatibility
- Sets window levels (`pop-up-menu`, `floating`) to appear above all apps
- Handles screen capture using `desktopCapturer`
- Manages permissions (Screen Recording, Accessibility)
- Manages IPC communication
- Integrates with OpenAI and Tavily APIs

#### electron/preload.ts
- Provides secure context bridge between main and renderer processes
- Exposes whitelisted IPC channels to React components

#### src/components/CaptureWindow.tsx
- Full-screen transparent overlay that works over fullscreen apps
- Dual selection modes: Rectangle and Lasso
- Rectangle mode: drag-to-select rectangular regions
- Lasso mode: free-form selection by drawing around shapes
- Shows real-time selection dimensions
- Sends selection coordinates to main process via IPC

#### src/components/ChatWindow.tsx
- Main user interface for AI interaction
- Displays captured screenshot
- Manages chat history
- Supports three modes: Chat, Annotate, and Factual Search
- Communicates with OpenAI via IPC

#### src/components/AnnotationCanvas.tsx
- Pro feature for annotating screenshots
- Tools: Pen, Arrow, Rectangle, Circle, Text
- Customizable colors and line widths
- Exports annotated image back to ChatWindow

## Freemium Model

### Free Tier
- Unlimited screen captures
- Basic AI chat with screenshots
- All core features

### Pro Tier (Planned)
- Annotation tools (drawing, shapes, text)
- Factual Search with real-time web results
- Priority support
- Increased API rate limits

To enable Pro features in the current build, the `isProUser` flag in `ChatWindow.tsx` is set to `true` for testing purposes.

## API Integration

### OpenAI GPT-4o

The app uses the `gpt-4o` model for vision and chat capabilities:

```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageBase64 } },
      ],
    },
    { role: 'user', content: userPrompt },
  ],
});
```

### Tavily Search API (Pro)

For Factual Search mode, the app:
1. Sends the user's query to Tavily Search API
2. Gets real-time web search results
3. Constructs a RAG (Retrieval-Augmented Generation) prompt
4. Sends the enhanced prompt + screenshot to OpenAI

**Note**: Currently using mock data. Uncomment the actual implementation in `electron/main.ts` to enable real Tavily integration.

## Security & Privacy

- **Context Isolation**: Enabled for security
- **Node Integration**: Disabled in renderer processes
- **Preload Script**: Whitelisted IPC channels only
- **No Data Collection**: All processing happens locally
- **API Keys**: Stored in environment variables, never in code

## Troubleshooting

### Overlay not appearing over fullscreen apps
- **macOS**: Ensure both Screen Recording AND Accessibility permissions are granted
- Restart the app after granting permissions
- Some apps with custom fullscreen modes may require additional configuration
- Check if Mission Control settings allow windows on all spaces

### Global hotkey not working
- Check if another app is using the same hotkey
- Try restarting the application
- On macOS, grant Accessibility permissions in System Preferences → Security & Privacy → Accessibility
- Some apps may block global shortcuts; try using the hotkey when another app is focused

### Screen capture shows black screen
- On macOS: Grant Screen Recording permissions in System Preferences → Security & Privacy → Screen Recording
- Restart the app after granting permissions
- On Windows: Ensure the app has necessary permissions
- Some protected content (DRM videos, banking apps) cannot be captured by design

### OpenAI API errors
- Verify your API key is correct
- Check your OpenAI account has available credits
- Ensure you have access to the GPT-4o model

### Build errors
- Delete `node_modules` and `package-lock.json`
- Run `npm install` again
- Make sure you're using Node.js 18 or higher

## Future Enhancements

- [ ] OCR text extraction from screenshots
- [ ] Screenshot history and management
- [ ] Custom hotkey configuration
- [ ] Multi-screen support
- [ ] Video capture mode
- [ ] Cloud sync for chat history (Pro)
- [ ] Team collaboration features (Pro)
- [ ] Plugins and extensions system
- [ ] Linux support

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- Powered by [OpenAI GPT-4o](https://openai.com/)
- Search powered by [Tavily](https://tavily.com/)
- UI built with [React](https://react.dev/) and [Vite](https://vitejs.dev/)

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

---

**Note**: This is a development version. Make sure to set up your API keys before running the application.
