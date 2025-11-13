import React, { useState, useRef, useEffect } from 'react';

interface Point {
  x: number;
  y: number;
}

interface Selection {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

type SelectionMode = 'rectangle' | 'lasso';

const CaptureWindow: React.FC = () => {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('rectangle');
  const [lassoPath, setLassoPath] = useState<Point[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log('CaptureWindow: Component mounted');
    console.log('CaptureWindow: window.electron available?', !!window.electron);
    console.log('CaptureWindow: window.electron.ipcRenderer available?', !!(window.electron && window.electron.ipcRenderer));
    
    // Set canvas size to full screen
    const updateCanvasSize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    // Global ESC key listener - with immediate action
    let escHandled = false;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !escHandled) {
        e.preventDefault();
        e.stopPropagation();
        escHandled = true;
        console.log('ESC pressed, closing window');
        if (window.electron?.ipcRenderer) {
          window.electron.ipcRenderer.send('close-window');
        }
        // Reset after a delay
        setTimeout(() => {
          escHandled = false;
        }, 500);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true); // Use capture phase

    return () => {
      window.removeEventListener('resize', updateCanvasSize);
      window.removeEventListener('keydown', handleKeyDown, true); // Match capture phase
    };
  }, []);

  useEffect(() => {
    // Draw selection (rectangle or lasso)
    if (canvasRef.current && (selection || lassoPath.length > 0)) {
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      // Clear canvas
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

      // Draw semi-transparent overlay over entire screen
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);

      if (selectionMode === 'rectangle' && selection) {
        // Rectangle mode
        const x = Math.min(selection.startX, selection.endX);
        const y = Math.min(selection.startY, selection.endY);
        const width = Math.abs(selection.endX - selection.startX);
        const height = Math.abs(selection.endY - selection.startY);

        // Clear the selection area (make it transparent to show screen underneath)
        ctx.clearRect(x, y, width, height);

        // Draw selection border
        ctx.strokeStyle = '#00a8ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);

        // Draw corner handles
        const handleSize = 8;
        ctx.fillStyle = '#00a8ff';

        // Top-left
        ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
        // Top-right
        ctx.fillRect(x + width - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
        // Bottom-left
        ctx.fillRect(x - handleSize / 2, y + height - handleSize / 2, handleSize, handleSize);
        // Bottom-right
        ctx.fillRect(x + width - handleSize / 2, y + height - handleSize / 2, handleSize, handleSize);

        // Display dimensions
        ctx.fillStyle = '#00a8ff';
        ctx.font = '14px sans-serif';
        const dimensionText = `${Math.round(width)} × ${Math.round(height)}`;
        const textMetrics = ctx.measureText(dimensionText);
        const textX = x + width / 2 - textMetrics.width / 2;
        const textY = y - 10;

        // Draw text background
        ctx.fillStyle = 'rgba(0, 168, 255, 0.9)';
        ctx.fillRect(textX - 5, textY - 16, textMetrics.width + 10, 20);

        // Draw text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(dimensionText, textX, textY);
      } else if (selectionMode === 'lasso' && lassoPath.length > 0) {
        // Lasso mode - draw the path and clear inside
        ctx.save();

        // Create clipping region for the lasso path
        ctx.beginPath();
        ctx.moveTo(lassoPath[0].x, lassoPath[0].y);
        for (let i = 1; i < lassoPath.length; i++) {
          ctx.lineTo(lassoPath[i].x, lassoPath[i].y);
        }
        ctx.closePath();

        // Clear inside the lasso (show screen underneath)
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        // Draw the lasso border
        ctx.strokeStyle = '#00a8ff';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Draw dots along the path
        ctx.fillStyle = '#00a8ff';
        for (let i = 0; i < lassoPath.length; i += 5) {
          ctx.beginPath();
          ctx.arc(lassoPath[i].x, lassoPath[i].y, 3, 0, 2 * Math.PI);
          ctx.fill();
        }

        ctx.restore();

        // Calculate and display bounding box dimensions
        if (lassoPath.length > 10) {
          const bounds = calculateBoundingBox(lassoPath);
          ctx.fillStyle = '#00a8ff';
          ctx.font = '14px sans-serif';
          const dimensionText = `${Math.round(bounds.width)} × ${Math.round(bounds.height)}`;
          const textMetrics = ctx.measureText(dimensionText);
          const textX = bounds.x + bounds.width / 2 - textMetrics.width / 2;
          const textY = bounds.y - 10;

          // Draw text background
          ctx.fillStyle = 'rgba(0, 168, 255, 0.9)';
          ctx.fillRect(textX - 5, textY - 16, textMetrics.width + 10, 20);

          // Draw text
          ctx.fillStyle = '#ffffff';
          ctx.fillText(dimensionText, textX, textY);
        }
      }
    }
  }, [selection, lassoPath, selectionMode]);

  const calculateBoundingBox = (path: Point[]): { x: number; y: number; width: number; height: number } => {
    if (path.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    let minX = path[0].x;
    let minY = path[0].y;
    let maxX = path[0].x;
    let maxY = path[0].y;

    for (const point of path) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsSelecting(true);

    if (selectionMode === 'rectangle') {
      setSelection({
        startX: e.clientX,
        startY: e.clientY,
        endX: e.clientX,
        endY: e.clientY,
      });
      setLassoPath([]);
    } else if (selectionMode === 'lasso') {
      setLassoPath([{ x: e.clientX, y: e.clientY }]);
      setSelection(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting) return;

    if (selectionMode === 'rectangle' && selection) {
      setSelection({
        ...selection,
        endX: e.clientX,
        endY: e.clientY,
      });
    } else if (selectionMode === 'lasso') {
      setLassoPath((prev) => [...prev, { x: e.clientX, y: e.clientY }]);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isSelecting) return;

    setIsSelecting(false);

    if (selectionMode === 'rectangle' && selection) {
      // Calculate final bounds
      const x = Math.min(selection.startX, selection.endX);
      const y = Math.min(selection.startY, selection.endY);
      const width = Math.abs(selection.endX - selection.startX);
      const height = Math.abs(selection.endY - selection.startY);

      // Only send selection if it has meaningful size
      if (width > 10 && height > 10) {
        // Send selection to main process
        console.log('Sending rectangle selection:', { x, y, width, height });
        if (window.electron && window.electron.ipcRenderer) {
          // Clear selection immediately for visual feedback
          setSelection(null);
          clearCanvas();
          
          // Send selection - the main process will handle closing the window immediately
          window.electron.ipcRenderer.send('selection-complete', {
            x,
            y,
            width,
            height,
          });
          console.log('Selection sent successfully');
        } else {
          console.error('window.electron.ipcRenderer is not available!');
        }
      } else {
        // Reset if selection is too small
        setSelection(null);
        clearCanvas();
      }
    } else if (selectionMode === 'lasso') {
      // For lasso, check if we have enough points (reduced threshold for better UX)
      if (lassoPath.length >= 5) {
        // Calculate bounding box from lasso path
        const bounds = calculateBoundingBox(lassoPath);

        // Only send selection if it has meaningful size
        if (bounds.width > 10 && bounds.height > 10) {
          // Send selection to main process
          console.log('Sending lasso selection:', bounds);
          if (window.electron && window.electron.ipcRenderer) {
            // Clear selection immediately for visual feedback
            setLassoPath([]);
            clearCanvas();
            
            // Send selection - the main process will handle closing the window immediately
            window.electron.ipcRenderer.send('selection-complete', {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            });
            console.log('Lasso selection sent successfully');
          } else {
            console.error('window.electron.ipcRenderer is not available!');
          }
        } else {
          // Reset if selection is too small
          setLassoPath([]);
          clearCanvas();
        }
      } else {
        // Reset if path is too short
        setLassoPath([]);
        clearCanvas();
      }
    } else {
      // Reset if no valid selection
      setLassoPath([]);
      setSelection(null);
      clearCanvas();
    }
  };

  const clearCanvas = () => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw',
        height: '100vh',
        position: 'fixed',
        top: 0,
        left: 0,
        cursor: selectionMode === 'lasso' ? 'crosshair' : 'crosshair',
        backgroundColor: 'transparent',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      tabIndex={0}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
        }}
      />

      {/* Mode Selection Buttons */}
      {!isSelecting && (
        <div
          style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            display: 'flex',
            gap: '12px',
            zIndex: 1000,
            pointerEvents: 'auto', // Ensure buttons are clickable
            cursor: 'default', // Override parent cursor for button area
          }}
          onMouseDown={(e) => e.stopPropagation()} // Prevent triggering selection when clicking buttons
          onMouseMove={(e) => e.stopPropagation()} // Prevent triggering selection when hovering buttons
        >
          <button
            onClick={() => setSelectionMode('rectangle')}
            style={{
              padding: '12px 20px',
              backgroundColor: selectionMode === 'rectangle' ? '#00a8ff' : 'rgba(0, 0, 0, 0.8)',
              color: 'white',
              border: selectionMode === 'rectangle' ? '2px solid #fff' : 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (selectionMode !== 'rectangle') {
                e.currentTarget.style.backgroundColor = 'rgba(0, 168, 255, 0.5)';
              }
            }}
            onMouseLeave={(e) => {
              if (selectionMode !== 'rectangle') {
                e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
              }
            }}
          >
            <span style={{ fontSize: '18px' }}>▢</span>
            Rectangle
          </button>

          <button
            onClick={() => setSelectionMode('lasso')}
            style={{
              padding: '12px 20px',
              backgroundColor: selectionMode === 'lasso' ? '#00a8ff' : 'rgba(0, 0, 0, 0.8)',
              color: 'white',
              border: selectionMode === 'lasso' ? '2px solid #fff' : 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (selectionMode !== 'lasso') {
                e.currentTarget.style.backgroundColor = 'rgba(0, 168, 255, 0.5)';
              }
            }}
            onMouseLeave={(e) => {
              if (selectionMode !== 'lasso') {
                e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
              }
            }}
          >
            <span style={{ fontSize: '18px' }}>○</span>
            Lasso
          </button>
        </div>
      )}

      {/* Instructions */}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '8px',
          fontSize: '14px',
          pointerEvents: 'none',
          display: (selection || lassoPath.length > 0) ? 'none' : 'block',
        }}
      >
        {selectionMode === 'rectangle'
          ? '📐 Click and drag to select a rectangular region'
          : '✏️ Click and drag to draw around the region'
        } • Press ESC to cancel
      </div>
    </div>
  );
};

export default CaptureWindow;
