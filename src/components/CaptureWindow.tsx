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

const CaptureWindow: React.FC = () => {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Set canvas size to full screen
    const updateCanvasSize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    return () => {
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, []);

  useEffect(() => {
    // Draw selection rectangle
    if (canvasRef.current && selection) {
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      // Clear canvas
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

      // Draw semi-transparent overlay over entire screen
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);

      // Calculate selection bounds
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
    }
  }, [selection]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsSelecting(true);
    setSelection({
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting || !selection) return;

    setSelection({
      ...selection,
      endX: e.clientX,
      endY: e.clientY,
    });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isSelecting || !selection) return;

    setIsSelecting(false);

    // Calculate final bounds
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);

    // Only send selection if it has meaningful size
    if (width > 10 && height > 10) {
      // Send selection to main process
      window.electron.ipcRenderer.send('selection-complete', {
        x,
        y,
        width,
        height,
      });
    } else {
      // Reset if selection is too small
      setSelection(null);

      // Clear canvas
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // ESC to cancel
    if (e.key === 'Escape') {
      window.electron.ipcRenderer.send('close-window');
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
        cursor: 'crosshair',
        backgroundColor: 'transparent',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onKeyDown={handleKeyDown}
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
          display: selection ? 'none' : 'block',
        }}
      >
        Click and drag to select a region • Press ESC to cancel
      </div>
    </div>
  );
};

export default CaptureWindow;
