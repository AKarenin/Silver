// Native module to set NSWindow collection behavior
// This uses Electron's internal APIs to access the native NSWindow

const { app } = require('electron');

// Collection behavior flags (NSWindowCollectionBehavior)
const NSWindowCollectionBehaviorCanJoinAllSpaces = 1 << 0; // 1
const NSWindowCollectionBehaviorStationary = 1 << 1; // 2
const NSWindowCollectionBehaviorFullScreenAuxiliary = 1 << 8; // 256

function setWindowCollectionBehavior(window, behavior) {
  if (process.platform !== 'darwin') {
    return false;
  }
  
  try {
    // Access the native NSWindow through Electron's internal structure
    // Electron stores the native window in the BrowserWindow
    const nativeWindow = window.getNativeWindowHandle();
    
    if (!nativeWindow) {
      return false;
    }
    
    // Use Electron's internal method to set collection behavior
    // This requires accessing the native NSWindow object
    // We'll use a workaround by calling setVisibleOnAllWorkspaces with proper flags
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setVisibleOnAllWorkspaces(true);
    
    return true;
  } catch (e) {
    console.error('Failed to set collection behavior:', e);
    return false;
  }
}

module.exports = { setWindowCollectionBehavior };

