#include <napi.h>
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

// Window delegate to prevent window from being demoted
@interface OverlayWindowDelegate : NSObject <NSWindowDelegate>
@property (nonatomic, assign) NSWindowCollectionBehavior desiredBehavior;
@property (nonatomic, assign) NSWindow *targetWindow; // Use assign to avoid retain cycle (window retains delegate)
@end

@implementation OverlayWindowDelegate

// DISABLED: These delegate methods cause infinite recursion
// The main.ts keep-on-top interval handles window positioning
// We only need the delegate to prevent window from being demoted, not actively manage it
/*
- (void)windowDidBecomeKey:(NSNotification *)notification {
  // Disabled to prevent recursion
}

- (void)windowDidResignKey:(NSNotification *)notification {
  // Disabled to prevent recursion
}

- (void)windowDidChangeOrdering:(NSNotification *)notification {
  // Disabled to prevent recursion
}
*/

- (BOOL)windowShouldClose:(NSWindow *)sender {
  return YES;
}

// REMOVED: keepWindowOnTop method - main.ts already handles keep-on-top interval
// The delegate only handles window events to prevent demotion, not periodic checks

// Removed windowWillClose - not needed without keepWindowOnTop loop

@end

// Native module to set NSWindow collection behavior
// This allows the window to appear over fullscreen apps like Raycast does

Napi::Value SetWindowCollectionBehavior(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected 2 arguments: windowId and behavior")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  
  // Electron's getNativeWindowHandle returns a Buffer with window ID
  // We need to find the NSWindow by iterating through all windows
  uint32_t windowId = info[0].As<Napi::Number>().Uint32Value();
  unsigned long behavior = info[1].As<Napi::Number>().Uint32Value();
  
  @autoreleasepool {
    // Find the window by iterating through all application windows
    NSArray* windows = [[NSApplication sharedApplication] windows];
    for (NSWindow* window in windows) {
      // Check if this is the window we're looking for
      // We'll match by checking if the window's contentView matches
      if (window && [window windowNumber] == windowId) {
        // CRITICAL: Get current behavior, clear conflicting flags, and set in one operation
        NSWindowCollectionBehavior currentBehavior = [window collectionBehavior];
        NSWindowCollectionBehavior clearedBehavior = currentBehavior;
        clearedBehavior &= ~NSWindowCollectionBehaviorMoveToActiveSpace;
        // DON'T clear CanJoinAllSpaces if we're trying to set it
        if (!(behavior & NSWindowCollectionBehaviorCanJoinAllSpaces)) {
          clearedBehavior &= ~NSWindowCollectionBehaviorCanJoinAllSpaces;
        }
        
        // Combine and set in one call
        NSWindowCollectionBehavior finalBehavior = clearedBehavior | behavior;
        [window setCollectionBehavior:finalBehavior];
        return Napi::Boolean::New(env, true);
      }
    }
    
    // Alternative: Try to get window by ID directly
    NSWindow* targetWindow = [[NSApplication sharedApplication] windowWithWindowNumber:windowId];
    if (targetWindow) {
      // CRITICAL: Get current behavior, clear conflicting flags, and set in one operation
      NSWindowCollectionBehavior currentBehavior = [targetWindow collectionBehavior];
      NSWindowCollectionBehavior clearedBehavior = currentBehavior;
      clearedBehavior &= ~NSWindowCollectionBehaviorMoveToActiveSpace;
      // DON'T clear CanJoinAllSpaces if we're trying to set it
      if (!(behavior & NSWindowCollectionBehaviorCanJoinAllSpaces)) {
        clearedBehavior &= ~NSWindowCollectionBehaviorCanJoinAllSpaces;
      }
      
      // Combine and set in one call
      NSWindowCollectionBehavior finalBehavior = clearedBehavior | behavior;
      [targetWindow setCollectionBehavior:finalBehavior];
      return Napi::Boolean::New(env, true);
    }
  }
  
  return Napi::Boolean::New(env, false);
}

// Get NSWindow directly from Electron's native handle
// Electron's getNativeWindowHandle returns a Buffer containing the window pointer
Napi::Value SetWindowCollectionBehaviorFromHandle(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected 2 arguments: windowHandle and behavior")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  
  // Electron's native window handle is a Buffer containing the window pointer
  // Use Buffer<uint8_t> instead of Buffer<void> to avoid compilation issues
  Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
  unsigned long behavior = info[1].As<Napi::Number>().Uint32Value();
  
  @autoreleasepool {
    NSWindow* targetWindow = nil;
    
    // Method 1: Try to extract window pointer from buffer
    // Electron's getNativeWindowHandle returns a Buffer, but the format might vary
    // Try different interpretations
    if (buffer.Length() >= 8) {
      // Try as direct pointer (most common)
      void* ptr = buffer.Data();
      NSWindow* window = *((NSWindow**)ptr);
      
      if (window && [window isKindOfClass:[NSWindow class]]) {
        targetWindow = window;
      } else {
        // Try as uint64_t pointer
        uint64_t windowPtr = 0;
        memcpy(&windowPtr, buffer.Data(), 8);
        window = (__bridge NSWindow*)(void*)windowPtr;
        
        if (window && [window isKindOfClass:[NSWindow class]]) {
          targetWindow = window;
        }
      }
    }
    
    // Method 2: If buffer method failed, find window by iterating through all windows
    // Look for a window with screen-saver level (highest level) OR toolbar type
    if (!targetWindow) {
      NSArray* windows = [[NSApplication sharedApplication] windows];
      NSWindow* highestLevelWindow = nil;
      NSWindow* toolbarWindow = nil;
      NSInteger highestLevel = -1;
      
      for (NSWindow* window in windows) {
        if (window) {
          NSInteger level = [window level];
          
          // Check if this is a toolbar window (our overlay uses type: 'toolbar')
          if ([window className] && [[window className] containsString:@"Toolbar"]) {
            toolbarWindow = window;
            NSLog(@"Found toolbar window: %@ (level: %ld)", [window className], (long)level);
          }
          
          // Find the window with the highest level (should be our overlay)
          // Don't require isVisible - window might not be visible yet
          if (level > highestLevel && level >= NSScreenSaverWindowLevel) {
            highestLevel = level;
            highestLevelWindow = window;
          }
        }
      }
      
      // Prefer toolbar window if found, otherwise use highest level
      if (toolbarWindow) {
        targetWindow = toolbarWindow;
        NSLog(@"Using toolbar window (level: %ld)", (long)[toolbarWindow level]);
      } else if (highestLevelWindow) {
        targetWindow = highestLevelWindow;
        NSLog(@"Found window by highest level: %ld", (long)highestLevel);
      }
    }
    
    // Method 3: Fallback - find any window at screen-saver level (even if not visible)
    if (!targetWindow) {
      NSArray* windows = [[NSApplication sharedApplication] windows];
      for (NSWindow* window in windows) {
        if (window && [window level] >= NSScreenSaverWindowLevel) {
          targetWindow = window;
          NSLog(@"Found window by screen-saver level");
          break;
        }
      }
    }
    
    // Method 4: Last resort - find the most recently created window
    if (!targetWindow) {
      NSArray* windows = [[NSApplication sharedApplication] windows];
      if (windows.count > 0) {
        // Get the last window in the array (most recently created)
        targetWindow = [windows lastObject];
        NSLog(@"Using last window as fallback");
      }
    }
    
    // Apply collection behavior if we found a window
    if (targetWindow) {
      NSLog(@"Setting collection behavior on window (level: %ld, type: %@)", (long)[targetWindow level], [targetWindow className]);
      @try {
        // CRITICAL: Get current behavior and clear conflicting flags
        NSWindowCollectionBehavior currentBehavior = [targetWindow collectionBehavior];
        NSLog(@"Current collection behavior: %lu, requested: %lu", (unsigned long)currentBehavior, (unsigned long)behavior);
        
        // Always clear MoveToActiveSpace first (even if not set, to be safe)
        NSWindowCollectionBehavior clearedBehavior = currentBehavior;
        clearedBehavior &= ~NSWindowCollectionBehaviorMoveToActiveSpace;
        
        // Check if we're trying to set CanJoinAllSpaces (bit 0 = 1)
        BOOL wantsCanJoinAllSpaces = (behavior & NSWindowCollectionBehaviorCanJoinAllSpaces) != 0;
        
        // If MoveToActiveSpace was set AND we want CanJoinAllSpaces, we have a conflict
        if ((currentBehavior & NSWindowCollectionBehaviorMoveToActiveSpace) && wantsCanJoinAllSpaces) {
          NSLog(@"MoveToActiveSpace conflict detected, clearing first...");
          // Clear MoveToActiveSpace first
          [targetWindow setCollectionBehavior:clearedBehavior];
          
          // Use dispatch_async to ensure the first call completes before the second
          dispatch_async(dispatch_get_main_queue(), ^{
            @try {
              // CRITICAL: Clear ALL existing flags first, then set ONLY what we want
              NSWindowCollectionBehavior finalBehavior = behavior;
              // First clear all collection behavior flags
              [targetWindow setCollectionBehavior:0];
              // Then set only the flags we want
              [targetWindow setCollectionBehavior:finalBehavior];
              NSLog(@"Set collection behavior (async): %lu (requested: %lu)", (unsigned long)finalBehavior, (unsigned long)behavior);
              
              // DON'T set up delegate - it causes infinite recursion
              // The main.ts keep-on-top interval handles window positioning
              // Just set the collection behavior and let Electron handle the rest
              
              // Force window to front immediately
              [targetWindow setLevel:NSScreenSaverWindowLevel];
              [targetWindow orderFrontRegardless];
              
              // DON'T start keepWindowOnTop loop here - main.ts already has a keep-on-top interval
              // The delegate will only handle window events to prevent demotion
            } @catch (NSException *exception) {
              NSLog(@"Failed to set collection behavior in async: %@", exception.reason);
            }
          });
          return Napi::Boolean::New(env, true);
        } else {
          // No conflict - safe to set directly
          // CRITICAL: Clear ALL existing flags first, then set ONLY what we want
          // This ensures we get exactly the behavior we request (257 = canJoinAllSpaces | fullScreenAuxiliary)
          NSWindowCollectionBehavior finalBehavior = behavior;
          @try {
            // First clear all collection behavior flags
            [targetWindow setCollectionBehavior:0];
            // Then set only the flags we want
            [targetWindow setCollectionBehavior:finalBehavior];
            NSLog(@"Set collection behavior (direct): %lu (requested: %lu)", (unsigned long)finalBehavior, (unsigned long)behavior);
            
            // DON'T set up delegate - it causes infinite recursion
            // The main.ts keep-on-top interval handles window positioning
            // Just set the collection behavior and let Electron handle the rest
            
            // Force window to front immediately
            [targetWindow setLevel:NSScreenSaverWindowLevel];
            [targetWindow orderFrontRegardless];
            
            // DON'T start keepWindowOnTop loop here - main.ts already has a keep-on-top interval
            // The delegate will only handle window events to prevent demotion
            
            return Napi::Boolean::New(env, true);
          } @catch (NSException *exception) {
            NSLog(@"Failed to set collection behavior: %@", exception.reason);
            return Napi::Boolean::New(env, false);
          }
        }
      } @catch (NSException *exception) {
        NSLog(@"Exception in setWindowCollectionBehaviorFromHandle: %@", exception.reason);
        return Napi::Boolean::New(env, false);
      }
    } else {
      NSLog(@"No target window found!");
    }
  }
  
  return Napi::Boolean::New(env, false);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(
    Napi::String::New(env, "setWindowCollectionBehavior"),
    Napi::Function::New(env, SetWindowCollectionBehavior)
  );
  exports.Set(
    Napi::String::New(env, "setWindowCollectionBehaviorFromHandle"),
    Napi::Function::New(env, SetWindowCollectionBehaviorFromHandle)
  );
  return exports;
}

NODE_API_MODULE(window_overlay, Init)

