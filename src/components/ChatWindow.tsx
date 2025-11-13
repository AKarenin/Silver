import React, { useState, useEffect, useRef } from 'react';
import AnnotationCanvas from './AnnotationCanvas';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

type Mode = 'chat' | 'annotate' | 'search';

const ChatWindow: React.FC = () => {
  const [baseImage, setBaseImage] = useState<string>('');
  const [annotatedImage, setAnnotatedImage] = useState<string>('');
  const [mode, setMode] = useState<Mode>('chat');
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isProUser, setIsProUser] = useState(true); // Hardcoded to true for testing
  const [imageDataUrl, setImageDataUrl] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Helper function to crop image using canvas
  const cropImage = (imageDataUrl: string, bounds: { x: number; y: number; width: number; height: number }): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = bounds.width;
        canvas.height = bounds.height;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        
        // Draw the cropped portion
        ctx.drawImage(
          img,
          bounds.x, bounds.y,
          bounds.width, bounds.height,
          0, 0,
          bounds.width, bounds.height
        );
        
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageDataUrl;
    });
  };

  useEffect(() => {
    // Listen for image from main process
    console.log('ChatWindow: Setting up IPC listener for send-image-to-chat');
    if (!window.electron || !window.electron.ipcRenderer) {
      console.error('ChatWindow: window.electron.ipcRenderer is not available!');
      return;
    }
    
    const unsubscribe = window.electron.ipcRenderer.on(
      'send-image-to-chat',
      (data: string) => {
        console.log('ChatWindow: Received image from main process, data length:', data?.length || 0);
        setBaseImage(data);

        // Parse and crop image if bounds are provided
        try {
          const parsed = JSON.parse(data);
          if (parsed.image && parsed.bounds) {
            // Crop the image using canvas
            cropImage(parsed.image, parsed.bounds).then((cropped) => {
              setImageDataUrl(cropped);
            });
          } else if (parsed.image) {
            setImageDataUrl(parsed.image);
          }
        } catch {
          // Not JSON, use as-is
          setImageDataUrl(data);
        }
      }
    );

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const handleAnnotateClick = () => {
    setMode('annotate');
  };

  const handleAnnotationComplete = (annotated: string) => {
    setAnnotatedImage(annotated);
    setImageDataUrl(annotated);
    setMode('chat');
  };

  const handleAnnotationCancel = () => {
    setMode('chat');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!userInput.trim()) return;

    const userMessage: Message = {
      role: 'user',
      content: userInput,
    };

    setChatHistory([...chatHistory, userMessage]);
    setUserInput('');
    setIsLoading(true);

    try {
      let response;

      if (mode === 'search') {
        // Factual Search mode (Pro feature)
        response = await handleFactualSearch(userInput);
      } else {
        // Regular chat mode
        response = await handleChat(userInput);
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: response,
      };

      setChatHistory((prev) => [...prev, assistantMessage]);
    } catch (error: any) {
      console.error('Error:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: `Error: ${error.message || 'Failed to get response'}`,
      };
      setChatHistory((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChat = async (prompt: string): Promise<string> => {
    // Use annotatedImage if available, otherwise use the cropped imageDataUrl
    // imageDataUrl is the actual cropped image, baseImage is just the raw data string
    const imageToSend = annotatedImage || imageDataUrl;

    if (!imageToSend) {
      throw new Error('No image available to send');
    }

    const response = await window.electron.ipcRenderer.invoke('openai-chat', {
      messages: [
        ...chatHistory,
        {
          role: 'user',
          content: prompt,
        },
      ],
      imageBase64: imageToSend,
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    return response.message;
  };

  const handleFactualSearch = async (prompt: string): Promise<string> => {
    // Step 1: Perform Tavily search
    const searchResponse = await window.electron.ipcRenderer.invoke(
      'tavily-search',
      {
        query: prompt,
      }
    );

    if (!searchResponse.success) {
      throw new Error(searchResponse.error);
    }

    // Step 2: Construct RAG prompt
    const searchResults = searchResponse.results
      .map((r: any, i: number) => `[${i + 1}] ${r.title}\n${r.content}`)
      .join('\n\n');

    const ragPrompt = `Based on these search results:\n\n${searchResults}\n\nAnd considering the provided image, please answer the following question:\n\n${prompt}`;

    // Step 3: Send to OpenAI with image
    const imageToSend = annotatedImage || baseImage;

    const response = await window.electron.ipcRenderer.invoke('openai-chat', {
      messages: [
        ...chatHistory,
        {
          role: 'user',
          content: ragPrompt,
        },
      ],
      imageBase64: imageToSend,
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    return response.message;
  };

  const renderModeButtons = () => {
    return (
      <div style={styles.modeButtons}>
        <button
          style={{
            ...styles.modeButton,
            ...(mode === 'chat' ? styles.activeModeButton : {}),
          }}
          onClick={() => setMode('chat')}
        >
          💬 Chat (Free)
        </button>

        {isProUser && (
          <>
            <button
              style={{
                ...styles.modeButton,
                ...styles.proButton,
                ...(mode === 'annotate' ? styles.activeModeButton : {}),
              }}
              onClick={handleAnnotateClick}
              disabled={!baseImage}
            >
              ✏️ Annotate (Pro)
            </button>
            <button
              style={{
                ...styles.modeButton,
                ...styles.proButton,
                ...(mode === 'search' ? styles.activeModeButton : {}),
              }}
              onClick={() => setMode('search')}
            >
              🔍 Factual Search (Pro)
            </button>
          </>
        )}
      </div>
    );
  };

  if (mode === 'annotate' && baseImage) {
    return (
      <AnnotationCanvas
        baseImage={baseImage}
        onComplete={handleAnnotationComplete}
        onCancel={handleAnnotationCancel}
      />
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Silver AI Assistant</h2>
        {isProUser && <span style={styles.proBadge}>PRO</span>}
      </div>

      {renderModeButtons()}

      {/* Image Preview */}
      {imageDataUrl && (
        <div style={styles.imagePreview}>
          <img
            src={imageDataUrl}
            alt="Captured region"
            style={styles.thumbnail}
          />
          {annotatedImage && (
            <span style={styles.annotatedBadge}>Annotated</span>
          )}
        </div>
      )}

      {/* Chat History */}
      <div style={styles.chatHistory}>
        {chatHistory.length === 0 && (
          <div style={styles.emptyState}>
            <p style={styles.emptyText}>
              {imageDataUrl
                ? 'Ask a question about the captured region...'
                : 'Press Cmd/Ctrl+Shift+S to capture a screen region'}
            </p>
            {mode === 'search' && (
              <p style={styles.modeDescription}>
                🔍 Factual Search mode: Your question will be enhanced with
                real-time web search results before being sent to the AI.
              </p>
            )}
          </div>
        )}

        {chatHistory.map((msg, idx) => (
          <div
            key={idx}
            style={{
              ...styles.message,
              ...(msg.role === 'user'
                ? styles.userMessage
                : styles.assistantMessage),
            }}
          >
            <div style={styles.messageRole}>
              {msg.role === 'user' ? '👤 You' : '🤖 Assistant'}
            </div>
            <div style={styles.messageContent}>{msg.content}</div>
          </div>
        ))}

        {isLoading && (
          <div style={{ ...styles.message, ...styles.assistantMessage }}>
            <div style={styles.messageRole}>🤖 Assistant</div>
            <div style={styles.messageContent}>
              <div style={styles.loadingDots}>
                <span>●</span>
                <span>●</span>
                <span>●</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} style={styles.inputForm}>
        <input
          type="text"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder={
            mode === 'search'
              ? 'Ask a question (will be enhanced with web search)...'
              : 'Ask a question about this selection...'
          }
          style={styles.input}
          disabled={isLoading}
        />
        <button
          type="submit"
          style={styles.submitButton}
          disabled={isLoading || !userInput.trim()}
        >
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: 'rgba(245, 245, 245, 0.95)', // Semi-transparent background
    backdropFilter: 'blur(10px)', // Blur effect for glassmorphism
    WebkitBackdropFilter: 'blur(10px)', // Safari support
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px',
    backgroundColor: 'rgba(255, 255, 255, 0.9)', // Semi-transparent white
    borderBottom: '1px solid rgba(224, 224, 224, 0.5)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
  },
  proBadge: {
    padding: '4px 12px',
    backgroundColor: '#ffd700',
    color: '#000',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold',
  },
  modeButtons: {
    display: 'flex',
    gap: '8px',
    padding: '12px 16px',
    backgroundColor: '#ffffff',
    borderBottom: '1px solid #e0e0e0',
  },
  modeButton: {
    padding: '8px 16px',
    border: '1px solid #ccc',
    borderRadius: '20px',
    backgroundColor: '#ffffff',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s',
  },
  proButton: {
    borderColor: '#ffd700',
  },
  activeModeButton: {
    backgroundColor: '#007bff',
    color: '#ffffff',
    borderColor: '#007bff',
  },
  imagePreview: {
    padding: '16px',
    backgroundColor: '#ffffff',
    borderBottom: '1px solid #e0e0e0',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  thumbnail: {
    maxWidth: '200px',
    maxHeight: '150px',
    border: '2px solid #ccc',
    borderRadius: '8px',
  },
  annotatedBadge: {
    padding: '4px 8px',
    backgroundColor: '#28a745',
    color: '#ffffff',
    borderRadius: '4px',
    fontSize: '12px',
  },
  chatHistory: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.5)', // Semi-transparent
    backdropFilter: 'blur(5px)',
    WebkitBackdropFilter: 'blur(5px)',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px 20px',
  },
  emptyText: {
    color: '#666',
    fontSize: '16px',
  },
  modeDescription: {
    marginTop: '12px',
    color: '#007bff',
    fontSize: '14px',
    fontStyle: 'italic',
  },
  message: {
    padding: '12px',
    borderRadius: '8px',
    maxWidth: '80%',
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#007bff',
    color: '#ffffff',
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.9)', // Semi-transparent
    border: '1px solid rgba(224, 224, 224, 0.5)',
    backdropFilter: 'blur(5px)',
    WebkitBackdropFilter: 'blur(5px)',
  },
  messageRole: {
    fontSize: '12px',
    fontWeight: 'bold',
    marginBottom: '4px',
    opacity: 0.8,
  },
  messageContent: {
    fontSize: '14px',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
  },
  loadingDots: {
    display: 'flex',
    gap: '4px',
  },
  inputForm: {
    display: 'flex',
    gap: '8px',
    padding: '16px',
    backgroundColor: 'rgba(255, 255, 255, 0.9)', // Semi-transparent
    borderTop: '1px solid rgba(224, 224, 224, 0.5)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
  },
  input: {
    flex: 1,
    padding: '12px',
    border: '1px solid #ccc',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
  },
  submitButton: {
    padding: '12px 24px',
    border: 'none',
    borderRadius: '8px',
    backgroundColor: '#007bff',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
};

// Add animation for loading dots
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes blink {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .loading-dots span:nth-child(1) {
    animation: blink 1.4s infinite;
    animation-delay: 0s;
  }

  .loading-dots span:nth-child(2) {
    animation: blink 1.4s infinite;
    animation-delay: 0.2s;
  }

  .loading-dots span:nth-child(3) {
    animation: blink 1.4s infinite;
    animation-delay: 0.4s;
  }
`;
document.head.appendChild(styleSheet);

export default ChatWindow;
