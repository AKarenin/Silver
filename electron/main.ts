import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, systemPreferences } from 'electron';
import path from 'path';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import OpenAI from 'openai';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../../.env') });

// Environment variables for API keys (should be set in .env file or environment)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

let captureWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let keepOnTopInterval: NodeJS.Timeout | null = null;
let isCreatingCaptureWindow = false;
let pendingImageData: string | null = null;

const deliverPendingImageToChat = () => {
  if (!pendingImageData) {
    console.log('⚠️ No pending image to deliver');
    return false;
  }
  if (chatWindow && !chatWindow.isDestroyed() && chatWindow.webContents) {
    console.log('📤 Delivering image to chat window, size:', Math.round(pendingImageData.length / 1024), 'KB');
    chatWindow.webContents.send('send-image-to-chat', pendingImageData);
    console.log('✅ Image delivered successfully');
    pendingImageData = null;
    return true;
  }
  console.log('⚠️ Chat window not ready, keeping image pending');
  return false;
};

const CAPTURE_WINDOW_SYMBOL = Symbol('silverCaptureWindow');

const markAsCaptureWindow = (win: BrowserWindow) => {
  (win as any)[CAPTURE_WINDOW_SYMBOL] = true;
};

const isCaptureWindowInstance = (win: BrowserWindow | null | undefined): win is BrowserWindow => {
  return !!win && !win.isDestroyed() && Boolean((win as any)[CAPTURE_WINDOW_SYMBOL]);
};

const forceCloseAllCaptureWindows = (options: { immediate?: boolean; except?: BrowserWindow | null } = {}) => {
  const { immediate = true, except = null } = options;
  const windows = BrowserWindow.getAllWindows();
  const victims = windows.filter((win) => isCaptureWindowInstance(win) && win !== except);

  if (victims.length) {
    console.log(`Force-closing ${victims.length} zombie capture window(s)`);
  }

  victims.forEach((win) => {
    try {
      win.removeAllListeners();
    } catch {
      // ignore
    }

    try {
      if (immediate) {
        win.destroy();
      } else {
        win.close();
      }
    } catch (error) {
      console.error('Failed to dispose capture window', error);
    }
  });
};

const teardownCaptureWindow = (opts: { immediate?: boolean } = {}) => {
  if (!captureWindow) return;

  const { immediate = false } = opts;

  // Clear keep-on-top interval
  if (keepOnTopInterval) {
    clearInterval(keepOnTopInterval);
    keepOnTopInterval = null;
  }

  const windowToDispose = captureWindow;
  captureWindow = null;

  try {
    windowToDispose.removeAllListeners();
  } catch {
    // ignore
  }

  if (!windowToDispose.isDestroyed()) {
    if (immediate) {
      windowToDispose.destroy();
    } else {
      windowToDispose.close();
    }
  }

  forceCloseAllCaptureWindows({ immediate: true });
};

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:5174';

/**
 * NOTE: For proper overlay functionality on macOS:
 * - The app requires Screen Recording permission
 * - The app requires Accessibility permission (critical for fullscreen overlay)
 * - Users will be prompted during first-run setup
 * - On Windows, the app requires administrator privileges for global hotkeys in some cases
 */

function createCaptureWindow() {
  if (isCreatingCaptureWindow) {
    console.log('createCaptureWindow called while already creating - skipping duplicate');
    return;
  }

  isCreatingCaptureWindow = true;
  try {
    // Tear down existing window if any (destroy immediately to avoid stacking)
    teardownCaptureWindow({ immediate: true });
    forceCloseAllCaptureWindows({ immediate: true });

  // CRITICAL: Ensure activation policy is set before creating window
  if (process.platform === 'darwin') {
    app.setActivationPolicy('accessory');
    console.log('Re-confirmed activation policy is accessory before creating capture window');
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size; // Use full size, not workAreaSize
  const { x, y } = primaryDisplay.bounds;

  console.log('Creating capture window:', { width, height, x, y });

  captureWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    transparent: true,
    frame: false,
    type: 'panel', // CRITICAL: panel type for fullscreen overlay without activation
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreen: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    focusable: true, // Needs focus to receive mouse/keyboard for selection
    acceptFirstMouse: true, // Allow clicking through to the overlay
    minimizable: false,
    closable: true,
    visibleOnAllWorkspaces: true, // Critical for fullscreen
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false, // Don't show immediately - set collection behavior first
  });

  // Helper to toggle visibility across workspaces without staying stuck on every display
  const setFullscreenVisibility = (enable: boolean) => {
    if (!captureWindow || captureWindow.isDestroyed()) return;
    try {
      captureWindow.setVisibleOnAllWorkspaces(enable, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    } catch (err) {
      console.warn('setVisibleOnAllWorkspaces failed:', err);
    }
  };

  // Set window properties to appear above ALL apps (Raycast-style overlay)
  // This mimics: NSWindow with .screenSaver level and [.canJoinAllSpaces, .fullScreenAuxiliary]
  captureWindow.setIgnoreMouseEvents(false);
  
  if (process.platform === 'darwin') {
    // Set window level to screen-saver (highest possible - equivalent to .screenSaver in Swift)
    captureWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    // Temporarily allow appearing on all workspaces so we can join fullscreen space
    setFullscreenVisibility(true);
    
    // CRITICAL: Set collection behavior BEFORE showing window
    // This ensures the window has the correct behavior from the start
    // Use native module to set collection behavior directly on NSWindow
    const setCollectionBehavior = async (): Promise<boolean> => {
      if (!captureWindow || captureWindow.isDestroyed()) {
        return false;
      }
      try {
        const require = createRequire(import.meta.url);
        const nativeModule = require('../native/build/Release/window-overlay.node');
        const nativeHandle = captureWindow.getNativeWindowHandle();
        
        if (nativeHandle && nativeModule.setWindowCollectionBehaviorFromHandle) {
          // CRITICAL: Use CanJoinAllSpaces + FullScreenAuxiliary like Spotlight
          // canJoinAllSpaces (1) allows appearing in all spaces including fullscreen apps
          // fullScreenAuxiliary (256) allows auxiliary window behavior in fullscreen mode
          const behavior = 1 | 256; // 257 = canJoinAllSpaces | fullScreenAuxiliary
          console.log(`Setting collection behavior: ${behavior} (1=canJoinAllSpaces | 2=stationary | 256=fullScreenAuxiliary)`);
          const success = nativeModule.setWindowCollectionBehaviorFromHandle(nativeHandle, behavior);
          if (success) {
            console.log('✓ Set native collection behavior: canJoinAllSpaces | stationary | fullScreenAuxiliary');
            return true;
          } else {
            console.log('⚠ Native module returned false, will retry...');
            return false;
          }
        }
      } catch (e: any) {
        console.log('⚠ Native module error:', e?.message || e);
        return false;
      }
      return false;
    };
    
    // CRITICAL: Set collection behavior SYNCHRONOUSLY and show immediately
    // This ensures the window appears on top of fullscreen apps from the start
    const initializeWindow = async () => {
      if (!captureWindow || captureWindow.isDestroyed()) return;
      
      // Set collection behavior first
      const success = await setCollectionBehavior();
      
      if (success) {
        // Also call setVisibleOnAllWorkspaces to ensure fullscreen support
        setFullscreenVisibility(true);
      } else {
        console.log('⚠ Native module failed, using Electron API fallback');
        setFullscreenVisibility(true);
      }
      
      // Show window IMMEDIATELY after collection behavior is set
      if (captureWindow && !captureWindow.isDestroyed()) {
        captureWindow.show();
        captureWindow.moveTop();
        captureWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        // Do NOT focus() - that activates the app and causes background jump
        console.log('✓ Window shown immediately with fullscreen overlay behavior');
      }
      
      // Retry a few times to ensure it sticks
      setTimeout(() => setCollectionBehavior(), 50);
      setTimeout(() => setCollectionBehavior(), 150);
    };
    
    // Call immediately with a tiny delay to let window handle be ready
    setTimeout(initializeWindow, 10);
    
    // Check permissions
    try {
      const screenAccess = systemPreferences.getMediaAccessStatus('screen');
      if (screenAccess !== 'granted') {
        console.warn('Screen recording permission:', screenAccess);
      }
    } catch (e) {
      // Ignore
    }
  } else {
    captureWindow.setAlwaysOnTop(true, 'floating', 1);
    setFullscreenVisibility(true);
    captureWindow.show(); // Non-macOS: show immediately
    captureWindow.focus();
  }
  
  // macOS: Window is shown inside initializeWindow() after collection behavior is set
  // This ensures proper fullscreen overlay from the start

  // Load URL
  const url = isDev ? `${VITE_DEV_SERVER_URL}?window=capture` : path.join(__dirname, '../dist/index.html');
  console.log('Loading URL:', url);
  
  if (isDev) {
    captureWindow.loadURL(url).then(() => {
      console.log('Capture window URL loaded');
      // Don't call focus() - overlay should appear without stealing focus
    }).catch(err => {
      console.error('Error loading capture window URL:', err);
    });
  } else {
    captureWindow.loadFile(url, { hash: 'capture' }).then(() => {
      console.log('Capture window file loaded');
      // Don't call focus() - overlay should appear without stealing focus
    }).catch(err => {
      console.error('Error loading capture window file:', err);
    });
  }

  // Keep window on top with aggressive periodic checks
  // This is critical for overlay windows that must stay on top
  // Clear any existing interval first
  if (keepOnTopInterval) {
    clearInterval(keepOnTopInterval);
    keepOnTopInterval = null;
  }
  
  keepOnTopInterval = setInterval(() => {
    if (captureWindow && !captureWindow.isDestroyed()) {
      if (process.platform === 'darwin') {
        // Re-apply screen-saver level aggressively
        captureWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        
        // Re-apply native collection behavior periodically to prevent Electron from changing it
        try {
          const require = createRequire(import.meta.url);
          const nativeModule = require('../native/build/Release/window-overlay.node');
          const nativeHandle = captureWindow.getNativeWindowHandle();
          if (nativeHandle && nativeModule.setWindowCollectionBehaviorFromHandle) {
            const behavior = 1 | 256; // 257 = canJoinAllSpaces | fullScreenAuxiliary
            nativeModule.setWindowCollectionBehaviorFromHandle(nativeHandle, behavior);
          }
        } catch (e) {
          // Ignore errors in periodic check
        }
      }
      
      // Force window to front (but don't focus - overlay windows shouldn't steal focus)
      captureWindow.moveTop();
      // Don't call focus() - overlay windows should stay on top without stealing focus
      // This prevents other apps from demoting our window
    } else {
      if (keepOnTopInterval) {
        clearInterval(keepOnTopInterval);
        keepOnTopInterval = null;
      }
    }
  }, 50); // Check every 50ms - more aggressive

  captureWindow.on('closed', () => {
    console.log('Capture window closed');
    if (keepOnTopInterval) {
      clearInterval(keepOnTopInterval);
      keepOnTopInterval = null;
    }
    captureWindow = null;
  });
  
  captureWindow.on('close', () => {
    // Clear interval when window is closing
    if (keepOnTopInterval) {
      clearInterval(keepOnTopInterval);
      keepOnTopInterval = null;
    }
  });

  // Safe logging function that handles EPIPE errors
  const safeLog = (fn: () => void) => {
    try {
      fn();
    } catch (e: any) {
      // Ignore EPIPE errors (broken pipe) when stdout/stderr is closed
      if (e.code !== 'EPIPE') {
        // Only re-throw if it's not an EPIPE error
        throw e;
      }
    }
  };

  captureWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    safeLog(() => {
      console.error('Capture window failed to load:', errorCode, errorDescription);
    });
  });

  captureWindow.webContents.on('did-finish-load', () => {
    console.log('Capture window finished loading');
    if (captureWindow && !captureWindow.isDestroyed()) {
      // Re-apply window level and collection behavior after load to ensure it's on top
      if (process.platform === 'darwin') {
        // Re-apply screen-saver level (highest possible)
        captureWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        
        // Re-apply native collection behavior after load
        // Also call setVisibleOnAllWorkspaces to ensure fullscreen support
        try {
          const require = createRequire(import.meta.url);
          const nativeModule = require('../native/build/Release/window-overlay.node');
          const nativeHandle = captureWindow.getNativeWindowHandle();
          if (nativeHandle && nativeModule.setWindowCollectionBehaviorFromHandle) {
            const behavior = 1 | 256; // 257 = canJoinAllSpaces | fullScreenAuxiliary
            console.log(`Applying collection behavior after load: ${behavior}`);
            const success = nativeModule.setWindowCollectionBehaviorFromHandle(nativeHandle, behavior);
            if (success) {
              console.log('✓ Applied native collection behavior after window load');
              // Also set visible on all workspaces for fullscreen support
              captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
              console.log('✓ Also set setVisibleOnAllWorkspaces with visibleOnFullScreen after load');
            }
          }
        } catch (e: any) {
          // Silently fail - don't use Electron API as fallback (it causes conflicts)
          console.log('Native module not available after window load');
        }
      } else {
        captureWindow.setAlwaysOnTop(true, 'floating', 1);
      }
      // Don't show again - window is already shown earlier
      captureWindow.moveTop();
      // Don't call focus() - overlay windows should stay on top without stealing focus
      
      // Force to front again after a small delay to ensure it stays on top
      setTimeout(() => {
        if (captureWindow && !captureWindow.isDestroyed()) {
          captureWindow.moveTop();
          if (process.platform === 'darwin') {
            captureWindow.setAlwaysOnTop(true, 'screen-saver', 1);
          }
        }
      }, 50);
      
      console.log('Capture window is visible:', captureWindow.isVisible());
      console.log('Window level: screen-saver, collection behavior: canJoinAllSpaces | fullScreenAuxiliary');
    }
  });

  // Listen for console messages from renderer
  captureWindow.webContents.on('console-message', (event, level, message) => {
    safeLog(() => {
      console.log(`[CaptureWindow Renderer ${level}]:`, message);
    });
  });

  // Listen for renderer process crashes
  captureWindow.webContents.on('render-process-gone', (event, details) => {
    safeLog(() => {
      console.error('Capture window renderer process crashed:', details);
    });
  });

  // Listen for uncaught exceptions
  captureWindow.webContents.on('unresponsive', () => {
    safeLog(() => {
      console.error('Capture window became unresponsive');
    });
  });

  captureWindow.webContents.on('responsive', () => {
    safeLog(() => {
      console.log('Capture window became responsive again');
    });
  });

  markAsCaptureWindow(captureWindow);

  console.log('Capture window created and shown');
} catch (error) {
  console.error('Failed to create capture window:', error);
  teardownCaptureWindow({ immediate: true });
} finally {
  isCreatingCaptureWindow = false;
}

function createChatWindow() {
  // Close existing window if any
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.close();
  }

  console.log('Creating new chat window');

  chatWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    show: true, // Show immediately
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  chatWindow.setAlwaysOnTop(true, 'floating', 1);

  const url = isDev ? `${VITE_DEV_SERVER_URL}?window=chat` : path.join(__dirname, '../dist/index.html');
  console.log('Loading chat URL:', url);

  if (isDev) {
    chatWindow.loadURL(url).then(() => {
      console.log('Chat window URL loaded');
      chatWindow?.focus();
    }).catch(err => {
      console.error('Error loading chat window URL:', err);
    });
  } else {
    chatWindow.loadFile(url, { hash: 'chat' }).then(() => {
      console.log('Chat window file loaded');
      chatWindow?.focus();
    }).catch(err => {
      console.error('Error loading chat window file:', err);
    });
  }

  chatWindow.webContents.on('did-finish-load', () => {
    console.log('Chat window finished loading');
    if (chatWindow) {
      chatWindow.show();
      chatWindow.focus();
      deliverPendingImageToChat();
    }
  });

  chatWindow.on('closed', () => {
    console.log('Chat window closed');
    chatWindow = null;
  });

  chatWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Chat window failed to load:', errorCode, errorDescription);
  });

  console.log('Chat window created and shown');
}

async function captureScreen(bounds: { x: number; y: number; width: number; height: number }): Promise<string> {
  try {
    console.log('captureScreen: Starting capture with bounds:', bounds);
    const primaryDisplay = screen.getPrimaryDisplay();
    const displaySize = primaryDisplay.size;
    const scaleFactor = primaryDisplay.scaleFactor; // Retina = 2, normal = 1

    console.log('captureScreen: Display size:', displaySize);
    console.log('📸 Capturing screen:', { bounds, scaleFactor });

    // Get screen sources with exact dimensions needed
    console.log('captureScreen: Calling desktopCapturer.getSources...');
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: displaySize.width * scaleFactor,
        height: displaySize.height * scaleFactor,
      },
    });
    console.log('captureScreen: Got', sources.length, 'sources');

    if (sources.length === 0) {
      throw new Error('No screen sources available');
    }

    // Find the primary screen source
    const primarySource = sources.find(source =>
      source.display_id === primaryDisplay.id.toString()
    ) || sources[0];
    console.log('captureScreen: Using source:', primarySource.name);

    // Crop IMMEDIATELY in native code (direct pixel manipulation, no intermediate encoding)
    const nativeImg = primarySource.thumbnail;
    const imgSize = nativeImg.getSize();
    console.log('captureScreen: Native image size:', imgSize);

    const cropRegion = {
      x: Math.round(bounds.x * scaleFactor),
      y: Math.round(bounds.y * scaleFactor),
      width: Math.round(bounds.width * scaleFactor),
      height: Math.round(bounds.height * scaleFactor),
    };

    console.log('✂️ Cropping to:', cropRegion);
    const croppedImg = nativeImg.crop(cropRegion);

    // Convert to PNG data URL (simple and works reliably)
    const dataUrl = croppedImg.toDataURL();
    console.log('captureScreen: Converted to data URL, length:', dataUrl.length);
    console.log('captureScreen: Data URL preview:', dataUrl.substring(0, 100));

    const sizeKB = Math.round(dataUrl.length / 1024);
    console.log('✅ Image cropped:', {
      dimensions: `${cropRegion.width}x${cropRegion.height}`,
      format: 'PNG',
      sizeKB,
    });

    return dataUrl;
  } catch (error) {
    console.error('captureScreen: Error capturing screen:', error);
    console.error('❌ Error capturing screen:', error);
    throw error;
  }
}

// cropImage function removed - cropping is now done in captureScreen

// Register global hotkey
function registerGlobalShortcut() {
  const ret = globalShortcut.register('CommandOrControl+Shift+S', () => {
    console.log('=== Global shortcut triggered ===');

    // CRITICAL: Keep app fully hidden - never activate it
    if (process.platform === 'darwin') {
      const currentPolicy = app.getActivationPolicy();
      if (currentPolicy !== 'accessory') {
        console.log(`⚠️ Activation policy was ${currentPolicy}, forcing to accessory`);
        app.setActivationPolicy('accessory');
      }
      // Ensure app stays hidden - do NOT focus the app
      app.hide();
    }

    if (captureWindow && !captureWindow.isDestroyed()) {
      console.log('Reusing existing capture window');
      // Bring to front without activating the app
      captureWindow.show();
      captureWindow.moveTop();
      if (process.platform === 'darwin') {
        captureWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      }
    } else {
      console.log('Creating new capture window');
      createCaptureWindow();
    }
  });

  if (!ret) {
    console.error('Global shortcut registration failed!');
  } else {
    console.log('Global shortcut registered successfully: Cmd/Ctrl+Shift+S');
  }
}

// IPC Handlers
ipcMain.handle('get-screen-sources', async (event, options) => {
  try {
    const sources = await desktopCapturer.getSources(options);
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
    }));
  } catch (error) {
    console.error('Error getting screen sources:', error);
    throw error;
  }
});

ipcMain.on('selection-complete', async (event, data) => {
  console.log('=== Selection complete event received ===');
  console.log('Selection data:', JSON.stringify(data));

  try {
    // Immediately close the capture window first - this is critical
    if (captureWindow && !captureWindow.isDestroyed()) {
      console.log('Closing capture window immediately after selection');
      teardownCaptureWindow({ immediate: true });
      // Small delay to ensure window is fully disposed
      await new Promise(resolve => setTimeout(resolve, 50));
    } else {
      console.log('Warning: capture window already destroyed or null');
    }

    // Get image data - either pre-cropped (polygon lasso) or capture screen (rectangle)
    let imageData: string;
    if (data.imageData) {
      // Polygon lasso provides pre-cropped image
      console.log('Using pre-cropped polygon image');
      imageData = data.imageData;
    } else {
      // Rectangle selection - capture and crop screen
      console.log('Starting screen capture for rectangle selection...');
      imageData = await captureScreen(data);
      console.log('Screen capture completed, image data length:', imageData?.length || 0);
    }

    // Cache image and ensure chat window exists
    pendingImageData = imageData;
    console.log('Creating chat window...');
    createChatWindow();

    const maxWait = 5000;
    const startTime = Date.now();
    const tryDeliver = () => {
      if (deliverPendingImageToChat()) {
        console.log('=== Image delivered to chat window ===');
        return;
      }
      if (Date.now() - startTime < maxWait) {
        console.log('Waiting for chat window... (elapsed:', Date.now() - startTime, 'ms)');
        setTimeout(tryDeliver, 100);
      } else {
        console.error('Chat window not available after waiting');
      }
    };
    tryDeliver();
  } catch (error) {
    console.error('=== Error processing selection ===');
    console.error('Error details:', error);
    teardownCaptureWindow({ immediate: true });
  }
});

ipcMain.on('close-window', (event) => {
  console.log('close-window IPC received');
  
  if (captureWindow && !captureWindow.isDestroyed()) {
    console.log('Closing capture window from close-window IPC');
    teardownCaptureWindow({ immediate: true });
    return;
  }

  const window = BrowserWindow.fromWebContents(event.sender);
  if (window && !window.isDestroyed()) {
    console.log('Closing window from close-window IPC (fallback)');
    window.hide();
    window.close();
  }
});

// OpenAI Chat Handler
ipcMain.handle('openai-chat', async (event, data) => {
  try {
    const { messages, imageBase64 } = data;

    console.log('🤖 OpenAI request:', {
      hasImage: !!imageBase64,
      imageLength: imageBase64?.length || 0,
      messageCount: messages?.length || 0
    });

    // Prepare messages for OpenAI
    const openaiMessages: any[] = [];

    // Add image if provided (only for first message or when annotations change)
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
      console.log('✅ Image added to OpenAI request');
    } else {
      console.log('ℹ️ No image in this request (using conversation context)');
    }

    // Add chat messages
    for (const msg of messages) {
      openaiMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    console.log('📤 Sending to GPT-4o...');
    // Call OpenAI API with streaming disabled for now (can enable later for even faster responses)
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: openaiMessages,
      max_tokens: 1500, // Increased for more detailed responses
    });

    const assistantMessage = response.choices[0]?.message?.content || 'No response from AI';
    console.log('✅ OpenAI response received');

    return {
      success: true,
      message: assistantMessage,
    };
  } catch (error: any) {
    console.error('❌ OpenAI API error:', error);
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

// Create setup window for first run
let setupWindow: BrowserWindow | null = null;

function createSetupWindow() {
  if (setupWindow) {
    setupWindow.focus();
    setupWindow.show();
    return;
  }

  setupWindow = new BrowserWindow({
    width: 800,
    height: 700,
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    center: true,
    show: false, // Don't show until ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Show window when ready to prevent flash
  setupWindow.once('ready-to-show', () => {
    setupWindow?.show();
    setupWindow?.focus();
  });

  if (isDev) {
    setupWindow.loadURL(`${VITE_DEV_SERVER_URL}?window=setup`);
  } else {
    setupWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: 'setup',
    });
  }

  setupWindow.on('closed', () => {
    setupWindow = null;
  });
}

// IPC Handlers for setup and permissions
ipcMain.handle('check-permissions', async () => {
  if (process.platform === 'darwin') {
    const screenStatus = systemPreferences.getMediaAccessStatus('screen');
    const accessibilityGranted = systemPreferences.isTrustedAccessibilityClient(false);

    return {
      screenRecording: screenStatus === 'granted',
      accessibility: accessibilityGranted,
    };
  }

  return {
    screenRecording: true,
    accessibility: true,
  };
});

ipcMain.handle('request-screen-recording', async () => {
  if (process.platform === 'darwin') {
    try {
      // Trigger the permission prompt by using desktopCapturer
      await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 }
      });

      const screenStatus = systemPreferences.getMediaAccessStatus('screen');
      return {
        granted: screenStatus === 'granted',
      };
    } catch (error) {
      console.error('Error requesting screen recording permission:', error);
      return { granted: false };
    }
  }

  return { granted: true };
});

ipcMain.handle('request-accessibility', async () => {
  if (process.platform === 'darwin') {
    // This triggers the macOS prompt to open System Preferences
    systemPreferences.isTrustedAccessibilityClient(true);

    const granted = systemPreferences.isTrustedAccessibilityClient(false);
    return { granted };
  }

  return { granted: true };
});

ipcMain.on('setup-complete', (event, data) => {
  console.log('Setup complete:', data);

  // Close setup window
  if (setupWindow) {
    setupWindow.close();
    setupWindow = null;
  }

  // Mark first run as complete
  const userDataPath = app.getPath('userData');
  const firstRunFlagPath = path.join(userDataPath, '.first-run-complete');

  try {
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true });
    }
    writeFileSync(firstRunFlagPath, JSON.stringify({
      completedAt: new Date().toISOString(),
      email: data.email,
      permissionsGranted: data.permissionsGranted,
    }));
  } catch (error) {
    console.error('Error creating first run flag:', error);
  }

  // Start background daemon
  startBackgroundDaemon();
});

function startBackgroundDaemon() {
  console.log('Starting background daemon...');

  // Hide dock icon and set activation policy (important for first-run after setup)
  if (process.platform === 'darwin') {
    app.dock.hide();

    // CRITICAL: First hide all windows to deactivate the app
    // This ensures the app is not active when we set accessory policy
    BrowserWindow.getAllWindows().forEach(win => {
      if (win && !win.isDestroyed()) {
        win.hide();
      }
    });

    app.setActivationPolicy('accessory');
    console.log('Set activation policy to accessory (prevents focus stealing)');

    // CRITICAL: Explicitly hide the app to ensure it's deactivated
    // Without this, the app might still be "active" from showing the setup window
    app.hide();
    console.log('✓ App hidden and deactivated - ready for overlay mode');
  }

  // Register global shortcut
  registerGlobalShortcut();
}

// App lifecycle
app.whenReady().then(async () => {
  console.log('App is ready');

  // Check if this is first run
  const userDataPath = app.getPath('userData');
  const firstRunFlagPath = path.join(userDataPath, '.first-run-complete');
  const isFirstRun = !existsSync(firstRunFlagPath);

  console.log('First run?', isFirstRun);

  if (isFirstRun) {
    // Show setup window on first run (needs normal activation for focus)
    console.log('First run - showing setup window');
    createSetupWindow();
  } else {
    // CRITICAL: Not first run - set activation policy IMMEDIATELY before creating any windows
    if (process.platform === 'darwin') {
      app.dock.hide();
      app.setActivationPolicy('accessory');
      app.hide(); // Ensure app is deactivated
      console.log('✓ Set activation policy to accessory, hid dock and app (prevents focus stealing)');
    }
    // Start background daemon directly
    console.log('Not first run - starting background daemon');
    startBackgroundDaemon();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // If no windows open and user activates, show setup if needed
      if (isFirstRun) {
        createSetupWindow();
      }
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
