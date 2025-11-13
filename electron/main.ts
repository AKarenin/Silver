import { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer } from 'electron';
import path from 'path';
import OpenAI from 'openai';

// Environment variables for API keys (should be set in .env file or environment)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

let captureWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:5173';

function createCaptureWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  captureWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  captureWindow.setIgnoreMouseEvents(false);
  captureWindow.setAlwaysOnTop(true, 'screen-saver');

  if (isDev) {
    captureWindow.loadURL(`${VITE_DEV_SERVER_URL}?window=capture`);
  } else {
    captureWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: 'capture',
    });
  }

  captureWindow.on('closed', () => {
    captureWindow = null;
  });
}

function createChatWindow() {
  if (chatWindow) {
    chatWindow.focus();
    return;
  }

  chatWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (isDev) {
    chatWindow.loadURL(`${VITE_DEV_SERVER_URL}?window=chat`);
  } else {
    chatWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: 'chat',
    });
  }

  chatWindow.once('ready-to-show', () => {
    chatWindow?.show();
  });

  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}

async function captureScreen(bounds: { x: number; y: number; width: number; height: number }): Promise<string> {
  try {
    // Get all available screen sources
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: screen.getPrimaryDisplay().size,
    });

    if (sources.length === 0) {
      throw new Error('No screen sources available');
    }

    // Get the primary screen source
    const primarySource = sources[0];
    const thumbnail = primarySource.thumbnail;

    // Convert to data URL
    const fullScreenDataUrl = thumbnail.toDataURL();

    // Crop the image to the selected bounds
    // We'll create a canvas in the main process to crop the image
    const croppedDataUrl = await cropImage(fullScreenDataUrl, bounds);

    return croppedDataUrl;
  } catch (error) {
    console.error('Error capturing screen:', error);
    throw error;
  }
}

async function cropImage(
  dataUrl: string,
  bounds: { x: number; y: number; width: number; height: number }
): Promise<string> {
  // Since we're in the main process, we need to use a different approach
  // We'll send the image to the renderer to crop it, or use a library like sharp
  // For simplicity, we'll return the full image and let the renderer handle cropping
  // In production, you'd want to use a library like sharp for server-side image processing

  // For now, return the full screen and bounds info
  // The renderer can handle the cropping
  return JSON.stringify({
    image: dataUrl,
    bounds: bounds,
  });
}

// Register global hotkey
function registerGlobalShortcut() {
  const ret = globalShortcut.register('CommandOrControl+Shift+S', () => {
    console.log('Global shortcut triggered');
    if (captureWindow) {
      captureWindow.focus();
    } else {
      createCaptureWindow();
    }
  });

  if (!ret) {
    console.log('Global shortcut registration failed');
  }
}

// IPC Handlers
ipcMain.on('selection-complete', async (event, data) => {
  console.log('Selection complete:', data);

  // Close capture window
  if (captureWindow) {
    captureWindow.close();
    captureWindow = null;
  }

  try {
    // Capture and crop screen
    const imageData = await captureScreen(data);

    // Create or focus chat window
    createChatWindow();

    // Wait a bit for the window to be ready
    setTimeout(() => {
      if (chatWindow) {
        chatWindow.webContents.send('send-image-to-chat', imageData);
      }
    }, 500);
  } catch (error) {
    console.error('Error processing selection:', error);
  }
});

ipcMain.on('close-window', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.close();
  }
});

// OpenAI Chat Handler
ipcMain.handle('openai-chat', async (event, data) => {
  try {
    const { messages, imageBase64 } = data;

    // Prepare messages for OpenAI
    const openaiMessages: any[] = [];

    // Add image if provided
    if (imageBase64) {
      // Check if imageBase64 is a JSON string with image and bounds
      let actualImageBase64 = imageBase64;
      try {
        const parsed = JSON.parse(imageBase64);
        if (parsed.image) {
          actualImageBase64 = parsed.image;
        }
      } catch {
        // Not JSON, use as-is
      }

      openaiMessages.push({
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: actualImageBase64,
            },
          },
        ],
      });
    }

    // Add chat messages
    for (const msg of messages) {
      openaiMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: openaiMessages,
      max_tokens: 1000,
    });

    const assistantMessage = response.choices[0]?.message?.content || 'No response from AI';

    return {
      success: true,
      message: assistantMessage,
    };
  } catch (error: any) {
    console.error('OpenAI API error:', error);
    return {
      success: false,
      error: error.message || 'Failed to get response from AI',
    };
  }
});

// Tavily Search Handler (Mocked for now)
ipcMain.handle('tavily-search', async (event, data) => {
  try {
    const { query } = data;

    // TODO: Implement actual Tavily API call
    // For now, return mock data
    const mockResults = [
      {
        title: 'Example Result 1',
        url: 'https://example.com/1',
        content: `Mock search result for "${query}". This is placeholder content.`,
      },
      {
        title: 'Example Result 2',
        url: 'https://example.com/2',
        content: `Another mock result about "${query}". Replace this with actual Tavily API integration.`,
      },
    ];

    return {
      success: true,
      results: mockResults,
    };

    // Actual Tavily implementation would look like:
    /*
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: query,
        search_depth: 'advanced',
        max_results: 5,
      }),
    });

    const data = await response.json();
    return {
      success: true,
      results: data.results,
    };
    */
  } catch (error: any) {
    console.error('Tavily search error:', error);
    return {
      success: false,
      error: error.message || 'Failed to perform search',
    };
  }
});

// App lifecycle
app.whenReady().then(() => {
  registerGlobalShortcut();

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      // Don't auto-create windows, wait for hotkey
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, don't quit the app when all windows are closed
  // The app should continue running in the background
  if (process.platform !== 'darwin') {
    // app.quit();
    // Keep app running for global hotkey
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});

// Prevent app from quitting when all windows are closed
app.on('before-quit', (event) => {
  // Only allow quit if explicitly requested
  // You can add a menu item or tray icon to quit the app
});
