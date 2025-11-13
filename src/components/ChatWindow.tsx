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
  const [initialAnalysis, setInitialAnalysis] = useState<string>(''); // Store initial AI analysis silently
  const [hasPreProcessed, setHasPreProcessed] = useState(false); // Track if image was pre-processed
  const [isPreProcessing, setIsPreProcessing] = useState(false); // Track if AI is pre-processing
  const [queuedQuery, setQueuedQuery] = useState<string>(''); // Queue user query during pre-processing
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Listen for image from main process
    console.log('ChatWindow: Setting up IPC listener for send-image-to-chat');
    if (!window.electron || !window.electron.ipcRenderer) {
      console.error('ChatWindow: window.electron.ipcRenderer is not available!');
      return;
    }

    const unsubscribe = window.electron.ipcRenderer.on(
      'send-image-to-chat',
      async (data: string) => {
        console.log('ChatWindow: Received image from main process, data length:', data?.length || 0);
        console.log('ChatWindow: Data preview:', data.substring(0, 100));
        console.log('📥 Received optimized image:', {
          sizeKB: Math.round(data.length / 1024),
          format: data.substring(11, 15),
        });

        // Clear previous state for new image
        setInitialAnalysis('');
        setHasPreProcessed(false);
        setChatHistory([]);
        setAnnotatedImage('');

        // Image is already optimized (cropped + compressed) - use directly
        const processedImage = data;
        setBaseImage(processedImage);
        setImageDataUrl(processedImage);
        console.log('ChatWindow: Image set, length:', processedImage?.length || 0);

        // Skip pre-processing for now - just keep window open
        setIsPreProcessing(false);
        setHasPreProcessed(false);
        console.log('✅ Image loaded, skipping pre-processing');
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

  // Auto-send queued query when pre-processing completes
  useEffect(() => {
    const sendQueuedQuery = async () => {
      if (!isPreProcessing && queuedQuery && hasPreProcessed) {
        console.log('Pre-processing complete, auto-sending queued query:', queuedQuery);
        const query = queuedQuery;
        setQueuedQuery(''); // Clear queue
        setIsLoading(true);

        try {
          let response;

          if (mode === 'search') {
            response = await handleFactualSearch(query);
          } else {
            response = await handleChat(query);
          }

          const assistantMessage: Message = {
            role: 'assistant',
            content: response,
          };

          setChatHistory((prev) => [...prev, assistantMessage]);
        } catch (error: any) {
          console.error('Error sending queued query:', error);
          const errorMessage: Message = {
            role: 'assistant',
            content: `Error: ${error.message || 'Failed to get response'}`,
          };
          setChatHistory((prev) => [...prev, errorMessage]);
        } finally {
          setIsLoading(false);
        }
      }
    };

    sendQueuedQuery();
  }, [isPreProcessing, queuedQuery, hasPreProcessed]);

  const handleAnnotateClick = () => {
    setMode('annotate');
  };

  const handleAnnotationComplete = (annotated: string) => {
    setAnnotatedImage(annotated);
    setImageDataUrl(annotated);
    setMode('chat');

    // Silent pre-processing for annotated image
    setIsPreProcessing(true);
    setChatHistory([]); // Clear for new annotated context
    console.log('🔄 Pre-processing annotated image (silent)...');

    // DISABLED pre-processing for annotated images too
    // window.electron.ipcRenderer.invoke('openai-chat', {
    //   messages: [
    //     {
    //       role: 'user',
    //       content: 'Analyze this annotated image. Pay attention to annotations.',
    //     },
    //   ],
    //   imageBase64: annotated,
    // }).then((response) => {
    //   if (response.success) {
    //     setHasPreProcessed(true);
    //     console.log('✅ Annotated image ready');
    //   }
    // }).catch((error) => {
    //   console.error('Annotation pre-processing error:', error);
    // }).finally(() => {
    //   setIsPreProcessing(false);
    // });
    
    // Skip pre-processing - just keep window open
    setIsPreProcessing(false);
    setHasPreProcessed(false);
    console.log('✅ Annotated image loaded, skipping pre-processing');
  };

  const handleAnnotationCancel = () => {
    setMode('chat');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!userInput.trim()) return;

    // If AI is still pre-processing, queue the query instead of sending immediately
    if (isPreProcessing) {
      console.log('Pre-processing in progress, queuing user query...');
      setQueuedQuery(userInput);
      setUserInput('');

      // Add user message to chat history immediately for UX
      const userMessage: Message = {
        role: 'user',
        content: userInput,
      };
      setChatHistory([...chatHistory, userMessage]);
      return;
    }

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
    const imageToSend = annotatedImage || imageDataUrl;

    if (!imageToSend) {
      throw new Error('No image available to send');
    }

    // chatHistory already contains all messages including the current user message
    // (added in handleSubmit before calling this function)
    const conversationMessages = [...chatHistory];

    // Send image only if this is the first user message
    // Check if there's only 1 message (the one just added) and it's from the user
    const isFirstMessage = chatHistory.length === 1 && chatHistory[0].role === 'user';

    console.log('💬 Sending to AI:', {
      messageCount: conversationMessages.length,
      isFirstMessage,
      sendingImage: isFirstMessage,
      imageLength: imageToSend.length
    });

    const response = await window.electron.ipcRenderer.invoke('openai-chat', {
      messages: conversationMessages,
      imageBase64: isFirstMessage ? imageToSend : undefined,
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    console.log('✅ AI response received');
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
    const imageToSend = annotatedImage || imageDataUrl;

    // chatHistory already contains the user's original question
    // Check if this is the first message to determine if we should send the image
    const isFirstMessage = chatHistory.length === 1 && chatHistory[0].role === 'user';

    const response = await window.electron.ipcRenderer.invoke('openai-chat', {
      messages: [
        ...chatHistory.slice(0, -1), // All messages except the last one (current user question)
        {
          role: 'user',
          content: ragPrompt, // Replace user's question with RAG-enhanced version
        },
      ],
      imageBase64: isFirstMessage ? imageToSend : undefined,
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
              disabled={!imageDataUrl}
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

  if (mode === 'annotate' && imageDataUrl) {
    return (
      <AnnotationCanvas
        baseImage={imageDataUrl}
        onComplete={handleAnnotationComplete}
        onCancel={handleAnnotationCancel}
      />
    );
  }

  const handleCloseWindow = () => {
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.send('close-window');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>Silver AI Assistant</h2>
          {isProUser && <span style={styles.proBadge}>PRO</span>}
        </div>
        <button
          onClick={handleCloseWindow}
          style={styles.closeButton}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#ff5252';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          title="Close"
        >
          ✕
        </button>
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
                ? 'Ask a question about this image...'
                : 'Press Cmd/Ctrl+Shift+S to capture a screen region'}
            </p>
            {mode === 'search' && imageDataUrl && (
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

        {isLoading && !queuedQuery && (
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

        {queuedQuery && (
          <div style={{ ...styles.message, ...styles.assistantMessage }}>
            <div style={styles.messageRole}>⏳ Queued</div>
            <div style={styles.messageContent}>
              Waiting for AI to finish analyzing image...
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
            isPreProcessing
              ? 'Type your question (will send when ready)...'
              : mode === 'search'
              ? 'Ask a question (will be enhanced with web search)...'
              : 'Ask a question about this selection...'
          }
          style={styles.input}
          disabled={isLoading && !isPreProcessing}
        />
        <button
          type="submit"
          style={styles.submitButton}
          disabled={(isLoading && !isPreProcessing) || !userInput.trim()}
        >
          {isPreProcessing && queuedQuery
            ? 'Queued'
            : isPreProcessing
            ? 'Queue'
            : isLoading
            ? 'Sending...'
            : 'Send'}
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
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#666',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    fontWeight: 'bold',
    padding: 0,
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
