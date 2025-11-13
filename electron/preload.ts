import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel: string, data?: any) => {
      // Whitelist channels
      const validChannels = [
        'selection-complete',
        'close-window',
        'annotation-complete',
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    on: (channel: string, func: (...args: any[]) => void) => {
      const validChannels = [
        'send-image-to-chat',
        'show-capture-window',
      ];
      if (validChannels.includes(channel)) {
        // Deliberately strip event as it includes `sender`
        const subscription = (_event: any, ...args: any[]) => func(...args);
        ipcRenderer.on(channel, subscription);

        // Return unsubscribe function
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      }
    },
    once: (channel: string, func: (...args: any[]) => void) => {
      const validChannels = [
        'send-image-to-chat',
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.once(channel, (_event, ...args) => func(...args));
      }
    },
    invoke: (channel: string, data?: any) => {
      const validChannels = [
        'get-screen-sources',
        'openai-chat',
        'tavily-search',
      ];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, data);
      }
      return Promise.reject(new Error(`Invalid channel: ${channel}`));
    },
  },
});

// Type definitions for window.electron
declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        send: (channel: string, data?: any) => void;
        on: (channel: string, func: (...args: any[]) => void) => (() => void) | undefined;
        once: (channel: string, func: (...args: any[]) => void) => void;
        invoke: (channel: string, data?: any) => Promise<any>;
      };
    };
  }
}
