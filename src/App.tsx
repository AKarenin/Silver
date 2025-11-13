import React, { useEffect, useState } from 'react';
import CaptureWindow from './components/CaptureWindow';
import ChatWindow from './components/ChatWindow';

type WindowType = 'capture' | 'chat' | 'unknown';

const App: React.FC = () => {
  const [windowType, setWindowType] = useState<WindowType>('unknown');

  useEffect(() => {
    // Determine which window to show based on URL hash or query parameter
    const determineWindowType = () => {
      const hash = window.location.hash.substring(1); // Remove the '#'
      const params = new URLSearchParams(window.location.search);
      const windowParam = params.get('window');

      if (hash === 'capture' || windowParam === 'capture') {
        return 'capture';
      } else if (hash === 'chat' || windowParam === 'chat') {
        return 'chat';
      } else {
        // Default to chat window if no specific window type is specified
        return 'chat';
      }
    };

    setWindowType(determineWindowType());

    // Listen for hash changes
    const handleHashChange = () => {
      setWindowType(determineWindowType());
    };

    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  if (windowType === 'capture') {
    return <CaptureWindow />;
  }

  if (windowType === 'chat') {
    return <ChatWindow />;
  }

  // Loading state or default
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: '#f5f5f5',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ color: '#333' }}>Silver AI</h1>
        <p style={{ color: '#666' }}>
          Press Cmd/Ctrl+Shift+S to capture a screen region
        </p>
      </div>
    </div>
  );
};

export default App;
