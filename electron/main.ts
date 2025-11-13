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

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:5174';

/**
 * NOTE: For proper overlay functionality on macOS:
 * - The app requires Screen Recording permission
 * - The app requires Accessibility permission
 * - Users will be prompted on first run
 * - On Windows, the app requires administrator privileges for global hotkeys in some cases
 */

// Check and request necessary permissions on macOS
async function checkAndRequestPermissions() {
  if (process.platform === 'darwin') {
    const { dialog, shell } = await import('electron');

    // Check Screen Recording permission
    const screenStatus = systemPreferences.getMediaAccessStatus('screen');
    console.log('Screen Recording permission status:', screenStatus);

    if (screenStatus !== 'granted') {
      // Show dialog explaining the need for Screen Recording permission
      const screenResult = await dialog.showMessageBox({
        type: 'info',
        title: 'Screen Recording Permission Required',
        message: 'Silver needs Screen Recording permission to capture your screen.',
        detail: 'Click "Open System Preferences" to grant permission, then restart Silver.\n\nWithout this permission, Silver cannot capture screenshots.',
        buttons: ['Open System Preferences', 'Quit'],
        defaultId: 0,
        cancelId: 1,
      });

      if (screenResult.response === 0) {
        // Open System Preferences to Screen Recording
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');

        // Show follow-up dialog
        await dialog.showMessageBox({
          type: 'info',
          title: 'Grant Permission and Restart',
          message: 'Please follow these steps:',
          detail: '1. Enable "Silver" in Screen Recording\n2. Quit Silver completely\n3. Restart Silver\n\nThe app will now quit. Please restart after granting permission.',
          buttons: ['OK'],
        });

        app.quit();
        return false;
      } else {
        app.quit();
        return false;
      }
    }

    // Check Accessibility permission (for global hotkeys)
    // We can't directly check accessibility, but we can test if global shortcuts work
    // and guide the user if they don't
    const accessibilityGranted = systemPreferences.isTrustedAccessibilityClient(false);
    console.log('Accessibility permission (trusted client):', accessibilityGranted);

    if (!accessibilityGranted) {
      const accessResult = await dialog.showMessageBox({
        type: 'info',
        title: 'Accessibility Permission Required',
        message: 'Silver needs Accessibility permission for global hotkeys to work.',
        detail: 'This allows Silver to respond to Cmd+Shift+S even when other apps are in fullscreen.\n\nClick "Open System Preferences" to grant permission, then restart Silver.',
        buttons: ['Open System Preferences', 'Continue Anyway', 'Quit'],
        defaultId: 0,
        cancelId: 2,
      });

      if (accessResult.response === 0) {
        // Open System Preferences to Accessibility
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');

        await dialog.showMessageBox({
          type: 'info',
          title: 'Grant Permission and Restart',
          message: 'Please follow these steps:',
          detail: '1. Click the lock icon and authenticate\n2. Enable "Silver" in Accessibility\n3. Quit Silver completely\n4. Restart Silver\n\nThe app will now quit. Please restart after granting permission.',
          buttons: ['OK'],
        });

        app.quit();
        return false;
      } else if (accessResult.response === 2) {
        app.quit();
        return false;
      }
      // If user chose "Continue Anyway", proceed but warn that hotkeys may not work
    }

    console.log('All required permissions granted');

    // Show welcome message on first run
    const userDataPath = app.getPath('userData');
    const firstRunFlagPath = path.join(userDataPath, '.first-run-complete');

    if (!existsSync(firstRunFlagPath)) {
      const { dialog } = await import('electron');
      await dialog.showMessageBox({
        type: 'info',
        title: 'Welcome to Silver!',
        message: 'Silver is now running in the background.',
        detail: 'Press Cmd+Shift+S anytime to capture and analyze any part of your screen with AI.\n\nThe app runs invisibly - no dock icon, always ready.',
        buttons: ['Got it!'],
      });

      // Create first run flag
      try {
        if (!existsSync(userDataPath)) {
          mkdirSync(userDataPath, { recursive: true });
        }
        writeFileSync(firstRunFlagPath, new Date().toISOString());
      } catch (error) {
        console.error('Error creating first run flag:', error);
      }
    }

    return true;
  }

  // On other platforms, show welcome on first run
  return true;
}

function createCaptureWindow() {
  // Close existing window if any
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.close();
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
    type: 'toolbar', // CRITICAL: Use toolbar type like Spotlight - allows overlay over fullscreen apps
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreen: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false, // Don't show immediately - set collection behavior first
  });

  // Set window properties to appear above ALL apps (Raycast-style overlay)
  // This mimics: NSWindow with .screenSaver level and [.canJoinAllSpaces, .fullScreenAuxiliary]
  captureWindow.setIgnoreMouseEvents(false);
  
  if (process.platform === 'darwin') {
    // Set window level to screen-saver (highest possible - equivalent to .screenSaver in Swift)
    captureWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    
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
          // CRITICAL: Use all three flags like Spotlight does for fullscreen app overlay
          // canJoinAllSpaces (1) allows appearing in all spaces including fullscreen apps
          // stationary (2) keeps window in all spaces
          // fullScreenAuxiliary (256) allows auxiliary window behavior in fullscreen mode
          const behavior = 1 | 2 | 256; // canJoinAllSpaces | stationary | fullScreenAuxiliary = 259
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
    
    // Try to set collection behavior before showing
    // Wait a bit for window to be fully initialized
    setTimeout(async () => {
      if (!captureWindow || captureWindow.isDestroyed()) return;
      
      // Set collection behavior first
      const success = await setCollectionBehavior();
      
      if (success) {
        // Also call setVisibleOnAllWorkspaces to ensure fullscreen support
        if (captureWindow && !captureWindow.isDestroyed()) {
          captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
          console.log('✓ Also set setVisibleOnAllWorkspaces with visibleOnFullScreen');
        }
        // Now show the window after behavior is set
        captureWindow.show();
      } else {
        console.log('⚠ Native module failed, using Electron API fallback');
        if (captureWindow && !captureWindow.isDestroyed()) {
          captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
          captureWindow.show();
        }
      }
      
      // Retry a few times after showing to ensure it sticks
      setTimeout(() => setCollectionBehavior(), 100);
      setTimeout(() => setCollectionBehavior(), 300);
    }, 100);
    
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
    captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  
  // Force window to front after a brief delay to ensure it's on top
  // Use multiple attempts to ensure it stays on top
  setTimeout(() => {
    if (captureWindow && !captureWindow.isDestroyed()) {
      if (process.platform === 'darwin') {
        // Re-apply screen-saver level to ensure it stays on top
        captureWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        
        // Re-apply native collection behavior (don't use Electron API - it conflicts)
        try {
          const require = createRequire(import.meta.url);
          const nativeModule = require('../native/build/Release/window-overlay.node');
          const nativeHandle = captureWindow.getNativeWindowHandle();
          if (nativeHandle && nativeModule.setWindowCollectionBehaviorFromHandle) {
            const behavior = 1 | 2 | 256; // canJoinAllSpaces | stationary | fullScreenAuxiliary = 259
            console.log(`Re-applying collection behavior after window show: ${behavior}`);
            const success = nativeModule.setWindowCollectionBehaviorFromHandle(nativeHandle, behavior);
            if (success) {
              console.log('✓ Re-applied native collection behavior after window show');
            } else {
              console.log('⚠ Native module returned false after window show');
            }
          }
        } catch (e: any) {
          console.log('Native module not available after window show:', e?.message);
        }
      } else {
        captureWindow.setAlwaysOnTop(true, 'floating', 1);
      }
      captureWindow.show();
      captureWindow.moveTop();
      // Don't call focus() - overlay windows should stay on top without stealing focus
      
      // Force to front again after a small delay
      setTimeout(() => {
        if (captureWindow && !captureWindow.isDestroyed()) {
          captureWindow.moveTop();
          if (process.platform === 'darwin') {
            captureWindow.setAlwaysOnTop(true, 'screen-saver', 1);
          }
        }
      }, 50);
      
      console.log('Window shown and focused, level: screen-saver');
    }
  }, 100);

  // Load URL
  const url = isDev ? `${VITE_DEV_SERVER_URL}?window=capture` : path.join(__dirname, '../dist/index.html');
  console.log('Loading URL:', url);
  
  if (isDev) {
    captureWindow.loadURL(url).then(() => {
      console.log('Capture window URL loaded');
      captureWindow?.focus();
    }).catch(err => {
      console.error('Error loading capture window URL:', err);
    });
  } else {
    captureWindow.loadFile(url, { hash: 'capture' }).then(() => {
      console.log('Capture window file loaded');
      captureWindow?.focus();
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
            const behavior = 1 | 2 | 256; // canJoinAllSpaces | stationary | fullScreenAuxiliary = 259
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
            const behavior = 1 | 2 | 256; // canJoinAllSpaces | stationary | fullScreenAuxiliary = 259
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
      captureWindow.show();
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

  console.log('Capture window created and shown');
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
    const primaryDisplay = screen.getPrimaryDisplay();
    const displaySize = primaryDisplay.size;
    
    // Get screen sources with full resolution
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: displaySize, // Use full screen size for high quality
    });

    if (sources.length === 0) {
      throw new Error('No screen sources available');
    }

    // Find the primary screen source
    const primarySource = sources.find(source => 
      source.display_id === primaryDisplay.id.toString()
    ) || sources[0];

    // Get the native image
    const nativeImg = primarySource.thumbnail;
    const fullScreenDataUrl = nativeImg.toDataURL();
    
    // For now, return the full image with bounds
    // The renderer will handle cropping (ChatWindow already handles this)
    // This is simpler and avoids creating additional windows
    return JSON.stringify({
      image: fullScreenDataUrl,
      bounds: {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      },
    });
  } catch (error) {
    console.error('Error capturing screen:', error);
    throw error;
  }
}

// cropImage function removed - cropping is now done in captureScreen

// Register global hotkey
function registerGlobalShortcut() {
  const ret = globalShortcut.register('CommandOrControl+Shift+S', () => {
    console.log('=== Global shortcut triggered ===');
    if (captureWindow && !captureWindow.isDestroyed()) {
      console.log('Focusing existing capture window');
      captureWindow.focus();
      captureWindow.show();
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
ipcMain.on('selection-complete', async (event, data) => {
  console.log('=== Selection complete event received ===');
  console.log('Selection data:', JSON.stringify(data));

  // Store reference to window before we close it
  const windowToClose = captureWindow;

  try {
    // Immediately close the capture window first - this is critical
    if (windowToClose && !windowToClose.isDestroyed()) {
      console.log('Closing capture window immediately after selection');
      
      // CRITICAL: Clear the keep-on-top interval FIRST to prevent crash
      if (keepOnTopInterval) {
        clearInterval(keepOnTopInterval);
        keepOnTopInterval = null;
        console.log('Cleared keep-on-top interval');
      }
      
      // Clear the reference to prevent keep-on-top interval from interfering
      captureWindow = null;
      
      // Hide immediately for instant visual feedback
      windowToClose.hide();
      
      // Use close() instead of destroy() to avoid crashes
      // The 'closed' event handler will clean up properly
      windowToClose.close();
      
      // Small delay to ensure window is fully closed
      await new Promise(resolve => setTimeout(resolve, 100));
    } else {
      console.log('Warning: capture window already destroyed or null');
    }

    // Capture screen (overlay is now closed)
    console.log('Starting screen capture...');
    const imageData = await captureScreen(data);
    console.log('Screen capture completed, image data length:', imageData?.length || 0);

    // Create chat window
    console.log('Creating chat window...');
    createChatWindow();

    // Wait for chat window to be ready, then send image
    const maxWait = 5000; // 5 seconds max wait
    const startTime = Date.now();
    const checkAndSend = () => {
      if (chatWindow && !chatWindow.isDestroyed() && chatWindow.webContents) {
        console.log('Sending image to chat window');
        chatWindow.webContents.send('send-image-to-chat', imageData);
      } else if (Date.now() - startTime < maxWait) {
        setTimeout(checkAndSend, 100);
      } else {
        console.error('Chat window not available after waiting');
      }
    };
    setTimeout(checkAndSend, 500);
  } catch (error) {
    console.error('=== Error processing selection ===');
    console.error('Error details:', error);
    // Ensure window is closed on error
    if (windowToClose && !windowToClose.isDestroyed()) {
      windowToClose.destroy();
      captureWindow = null;
    }
  }
});

ipcMain.on('close-window', (event) => {
  console.log('close-window IPC received');
  const window = BrowserWindow.fromWebContents(event.sender);
  
  // Always close captureWindow if it exists
  if (captureWindow && !captureWindow.isDestroyed()) {
    console.log('Closing capture window from close-window IPC');
    
    // CRITICAL: Clear the keep-on-top interval FIRST to prevent crash
    if (keepOnTopInterval) {
      clearInterval(keepOnTopInterval);
      keepOnTopInterval = null;
    }
    
    // Hide immediately for instant visual feedback
    captureWindow.hide();
    // Clear reference to stop keep-on-top interval
    const windowToClose = captureWindow;
    captureWindow = null;
    // Use close() to avoid crashes - the 'closed' event will clean up
    windowToClose.close();
  } else if (window && !window.isDestroyed()) {
    console.log('Closing window from close-window IPC (fallback)');
    window.hide();
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
app.whenReady().then(async () => {
  // Check and request permissions first
  const permissionsGranted = await checkAndRequestPermissions();

  if (!permissionsGranted) {
    // Permission request failed or user quit
    return;
  }

  // On macOS, hide dock icon for true background daemon
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

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
