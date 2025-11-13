import React, { useState, useEffect } from 'react';

type SetupStep = 'welcome' | 'login' | 'permissions' | 'complete';

const SetupWindow: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<SetupStep>('welcome');
  const [email, setEmail] = useState('');
  const [permissionsGranted, setPermissionsGranted] = useState({
    screenRecording: false,
    accessibility: false,
  });

  useEffect(() => {
    // Check if we're on macOS and what permissions we have
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.invoke('check-permissions').then((result: any) => {
        setPermissionsGranted({
          screenRecording: result.screenRecording || false,
          accessibility: result.accessibility || false,
        });
      }).catch(err => {
        console.error('Error checking permissions:', err);
      });
    }
  }, [currentStep]);

  const handleWelcomeContinue = () => {
    setCurrentStep('login');
  };

  const handleLoginContinue = () => {
    // For now, just validate email format (placeholder)
    if (email && email.includes('@')) {
      setCurrentStep('permissions');
    } else {
      alert('Please enter a valid email address');
    }
  };

  const handleRequestScreenRecording = async () => {
    if (window.electron?.ipcRenderer) {
      try {
        const result = await window.electron.ipcRenderer.invoke('request-screen-recording');
        setPermissionsGranted(prev => ({
          ...prev,
          screenRecording: result.granted || false,
        }));
      } catch (error) {
        console.error('Error requesting screen recording:', error);
      }
    }
  };

  const handleRequestAccessibility = async () => {
    if (window.electron?.ipcRenderer) {
      try {
        const result = await window.electron.ipcRenderer.invoke('request-accessibility');
        setPermissionsGranted(prev => ({
          ...prev,
          accessibility: result.granted || false,
        }));
      } catch (error) {
        console.error('Error requesting accessibility:', error);
      }
    }
  };

  const handleComplete = () => {
    // Tell main process to complete setup and start background daemon
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.send('setup-complete', {
        email,
        permissionsGranted,
      });
    }
  };

  const allPermissionsGranted = permissionsGranted.screenRecording && permissionsGranted.accessibility;

  return (
    <div style={styles.container}>
      {/* Welcome Step */}
      {currentStep === 'welcome' && (
        <div style={styles.content}>
          <div style={styles.logo}>✨</div>
          <h1 style={styles.title}>Welcome to Silver</h1>
          <p style={styles.subtitle}>
            Your AI-powered contextual layer for everything on your screen
          </p>

          <div style={styles.features}>
            <div style={styles.feature}>
              <span style={styles.featureIcon}>🖱️</span>
              <div>
                <h3 style={styles.featureTitle}>Capture Anywhere</h3>
                <p style={styles.featureText}>Press Cmd+Shift+S to capture any region</p>
              </div>
            </div>
            <div style={styles.feature}>
              <span style={styles.featureIcon}>🤖</span>
              <div>
                <h3 style={styles.featureTitle}>AI Analysis</h3>
                <p style={styles.featureText}>Ask questions about what you captured</p>
              </div>
            </div>
            <div style={styles.feature}>
              <span style={styles.featureIcon}>⚡</span>
              <div>
                <h3 style={styles.featureTitle}>Always Ready</h3>
                <p style={styles.featureText}>Runs invisibly in the background</p>
              </div>
            </div>
          </div>

          <button style={styles.primaryButton} onClick={handleWelcomeContinue}>
            Get Started
          </button>
        </div>
      )}

      {/* Login Step */}
      {currentStep === 'login' && (
        <div style={styles.content}>
          <div style={styles.logo}>👤</div>
          <h1 style={styles.title}>Set Up Your Profile</h1>
          <p style={styles.subtitle}>
            Enter your email to personalize your Silver experience
          </p>

          <div style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={styles.input}
                autoFocus
              />
            </div>

            <div style={styles.note}>
              <strong>Privacy Note:</strong> Your email is stored locally only for app personalization.
              No account creation or authentication is required at this time.
            </div>
          </div>

          <button
            style={styles.primaryButton}
            onClick={handleLoginContinue}
            disabled={!email.trim()}
          >
            Continue
          </button>
        </div>
      )}

      {/* Permissions Step */}
      {currentStep === 'permissions' && (
        <div style={styles.content}>
          <div style={styles.logo}>🔐</div>
          <h1 style={styles.title}>Enable Overlay Permissions</h1>
          <p style={styles.subtitle}>
            Silver needs these permissions to work as an overlay on fullscreen apps
          </p>

          <div style={styles.permissionsList}>
            {/* Screen Recording */}
            <div style={styles.permissionItem}>
              <div style={styles.permissionHeader}>
                <div style={styles.permissionInfo}>
                  <span style={styles.permissionIcon}>📹</span>
                  <div>
                    <h3 style={styles.permissionTitle}>Screen Recording</h3>
                    <p style={styles.permissionDesc}>
                      Allows Silver to capture any region of your screen, including fullscreen apps
                    </p>
                  </div>
                </div>
                {permissionsGranted.screenRecording ? (
                  <span style={styles.grantedBadge}>✓ Granted</span>
                ) : (
                  <button
                    style={styles.secondaryButton}
                    onClick={handleRequestScreenRecording}
                  >
                    Grant Permission
                  </button>
                )}
              </div>
            </div>

            {/* Accessibility */}
            <div style={styles.permissionItem}>
              <div style={styles.permissionHeader}>
                <div style={styles.permissionInfo}>
                  <span style={styles.permissionIcon}>⌨️</span>
                  <div>
                    <h3 style={styles.permissionTitle}>Accessibility</h3>
                    <p style={styles.permissionDesc}>
                      <strong>Critical for fullscreen overlay:</strong> Enables global hotkey (Cmd+Shift+S)
                      and allows Silver to appear over fullscreen applications
                    </p>
                  </div>
                </div>
                {permissionsGranted.accessibility ? (
                  <span style={styles.grantedBadge}>✓ Granted</span>
                ) : (
                  <button
                    style={styles.secondaryButton}
                    onClick={handleRequestAccessibility}
                  >
                    Grant Permission
                  </button>
                )}
              </div>
            </div>
          </div>

          {allPermissionsGranted ? (
            <button style={styles.primaryButton} onClick={handleComplete}>
              Complete Setup
            </button>
          ) : (
            <div style={styles.warning}>
              <p style={{ margin: '0 0 10px 0', fontWeight: 'bold' }}>
                ⚠️ Permissions Required for Fullscreen Overlay
              </p>
              <p style={{ margin: '0 0 10px 0', fontSize: '14px' }}>
                Without these permissions, Silver cannot appear over fullscreen apps or respond to the global hotkey.
              </p>
              <button
                style={styles.tertiaryButton}
                onClick={handleComplete}
              >
                Skip for now (limited functionality)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  content: {
    maxWidth: '600px',
    width: '90%',
    backgroundColor: 'white',
    borderRadius: '20px',
    padding: '60px 40px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    textAlign: 'center',
  },
  logo: {
    fontSize: '64px',
    marginBottom: '20px',
  },
  title: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: '10px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '40px',
    lineHeight: '1.5',
  },
  features: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    marginBottom: '40px',
    textAlign: 'left',
  },
  feature: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '15px',
  },
  featureIcon: {
    fontSize: '32px',
  },
  featureTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#1a1a1a',
    margin: '0 0 5px 0',
  },
  featureText: {
    fontSize: '14px',
    color: '#666',
    margin: 0,
  },
  form: {
    marginBottom: '30px',
  },
  inputGroup: {
    marginBottom: '20px',
    textAlign: 'left',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '8px',
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    fontSize: '16px',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  note: {
    fontSize: '13px',
    color: '#666',
    backgroundColor: '#f5f5f5',
    padding: '12px',
    borderRadius: '8px',
    textAlign: 'left',
  },
  permissionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    marginBottom: '30px',
  },
  permissionItem: {
    backgroundColor: '#f9f9f9',
    borderRadius: '12px',
    padding: '20px',
    textAlign: 'left',
  },
  permissionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '20px',
  },
  permissionInfo: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '15px',
    flex: 1,
  },
  permissionIcon: {
    fontSize: '32px',
  },
  permissionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1a1a1a',
    margin: '0 0 5px 0',
  },
  permissionDesc: {
    fontSize: '14px',
    color: '#666',
    margin: 0,
  },
  grantedBadge: {
    backgroundColor: '#4caf50',
    color: 'white',
    padding: '8px 16px',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
  primaryButton: {
    width: '100%',
    padding: '16px',
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'white',
    backgroundColor: '#667eea',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'transform 0.2s, box-shadow 0.2s',
  },
  secondaryButton: {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#667eea',
    backgroundColor: 'white',
    border: '2px solid #667eea',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  },
  tertiaryButton: {
    padding: '12px 24px',
    fontSize: '14px',
    color: '#666',
    backgroundColor: 'transparent',
    border: '1px solid #ccc',
    borderRadius: '8px',
    cursor: 'pointer',
    marginTop: '10px',
  },
  warning: {
    backgroundColor: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '20px',
  },
};

export default SetupWindow;
