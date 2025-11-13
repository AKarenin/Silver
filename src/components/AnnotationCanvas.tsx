import React, { useRef, useState, useEffect } from 'react';

interface AnnotationCanvasProps {
  baseImage: string;
  onComplete: (annotatedImage: string) => void;
  onCancel: () => void;
}

type Tool = 'pen' | 'arrow' | 'rectangle' | 'circle' | 'text';

const AnnotationCanvas: React.FC<AnnotationCanvasProps> = ({
  baseImage,
  onComplete,
  onCancel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentTool, setCurrentTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#ff0000');
  const [lineWidth, setLineWidth] = useState(3);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);

  // Load base image onto canvas
  useEffect(() => {
    console.log('AnnotationCanvas: useEffect triggered, baseImage length:', baseImage?.length || 0);
    if (!canvasRef.current) {
      console.log('AnnotationCanvas: canvasRef not available');
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.log('AnnotationCanvas: Could not get canvas context');
      return;
    }

    const img = new Image();
    img.onload = () => {
      console.log('AnnotationCanvas: Image loaded successfully, size:', img.width, 'x', img.height);
      // Set canvas size to image size
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw image
      ctx.drawImage(img, 0, 0);
      setImageLoaded(true);
      console.log('AnnotationCanvas: Image drawn to canvas');
    };

    img.onerror = (error) => {
      console.error('AnnotationCanvas: Error loading image:', error);
    };

    // baseImage is now the already-cropped image data URL
    console.log('AnnotationCanvas: Setting img.src, length:', baseImage?.length || 0);
    console.log('AnnotationCanvas: Image URL preview:', baseImage?.substring(0, 100) || 'undefined');
    img.src = baseImage;
  }, [baseImage]);

  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imageLoaded) return;

    const pos = getMousePos(e);
    setIsDrawing(true);
    setStartPos(pos);

    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (currentTool === 'pen') {
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !imageLoaded) return;

    const pos = getMousePos(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    if (currentTool === 'pen') {
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
    // For other tools, we'll draw them on mouseUp
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !imageLoaded) return;

    const pos = getMousePos(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.fillStyle = 'transparent';

    switch (currentTool) {
      case 'arrow':
        drawArrow(ctx, startPos.x, startPos.y, pos.x, pos.y);
        break;
      case 'rectangle':
        ctx.strokeRect(
          startPos.x,
          startPos.y,
          pos.x - startPos.x,
          pos.y - startPos.y
        );
        break;
      case 'circle':
        const radius = Math.sqrt(
          Math.pow(pos.x - startPos.x, 2) + Math.pow(pos.y - startPos.y, 2)
        );
        ctx.beginPath();
        ctx.arc(startPos.x, startPos.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
        break;
      case 'text':
        const text = prompt('Enter text:');
        if (text) {
          ctx.font = '24px sans-serif';
          ctx.fillStyle = color;
          ctx.fillText(text, startPos.x, startPos.y);
        }
        break;
    }

    setIsDrawing(false);
  };

  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ) => {
    const headLength = 20;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    // Draw line
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    // Draw arrow head
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  };

  const handleComplete = () => {
    if (!canvasRef.current) return;

    const annotatedImage = canvasRef.current.toDataURL('image/png');
    onComplete(annotatedImage);
  };

  const handleClear = () => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reload base image
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };

    // baseImage is now the already-cropped image data URL
    img.src = baseImage;
  };

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <div style={styles.toolGroup}>
          <button
            style={{
              ...styles.toolButton,
              ...(currentTool === 'pen' ? styles.activeButton : {}),
            }}
            onClick={() => setCurrentTool('pen')}
            title="Pen"
          >
            ✏️
          </button>
          <button
            style={{
              ...styles.toolButton,
              ...(currentTool === 'arrow' ? styles.activeButton : {}),
            }}
            onClick={() => setCurrentTool('arrow')}
            title="Arrow"
          >
            ➡️
          </button>
          <button
            style={{
              ...styles.toolButton,
              ...(currentTool === 'rectangle' ? styles.activeButton : {}),
            }}
            onClick={() => setCurrentTool('rectangle')}
            title="Rectangle"
          >
            ▢
          </button>
          <button
            style={{
              ...styles.toolButton,
              ...(currentTool === 'circle' ? styles.activeButton : {}),
            }}
            onClick={() => setCurrentTool('circle')}
            title="Circle"
          >
            ○
          </button>
          <button
            style={{
              ...styles.toolButton,
              ...(currentTool === 'text' ? styles.activeButton : {}),
            }}
            onClick={() => setCurrentTool('text')}
            title="Text"
          >
            T
          </button>
        </div>

        <div style={styles.toolGroup}>
          <label style={styles.label}>
            Color:
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={styles.colorPicker}
            />
          </label>
          <label style={styles.label}>
            Size:
            <input
              type="range"
              min="1"
              max="10"
              value={lineWidth}
              onChange={(e) => setLineWidth(Number(e.target.value))}
              style={styles.slider}
            />
          </label>
        </div>

        <div style={styles.toolGroup}>
          <button style={styles.button} onClick={handleClear}>
            Clear
          </button>
          <button style={styles.button} onClick={onCancel}>
            Cancel
          </button>
          <button style={styles.primaryButton} onClick={handleComplete}>
            Done
          </button>
        </div>
      </div>

      <div style={styles.canvasContainer}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={styles.canvas}
        />
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#f5f5f5',
  },
  toolbar: {
    display: 'flex',
    gap: '16px',
    padding: '12px',
    backgroundColor: '#ffffff',
    borderBottom: '1px solid #e0e0e0',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  toolGroup: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  toolButton: {
    padding: '8px 12px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: '#ffffff',
    cursor: 'pointer',
    fontSize: '16px',
  },
  activeButton: {
    backgroundColor: '#007bff',
    color: '#ffffff',
    borderColor: '#007bff',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
  },
  colorPicker: {
    width: '40px',
    height: '30px',
    border: 'none',
    cursor: 'pointer',
  },
  slider: {
    width: '100px',
  },
  button: {
    padding: '8px 16px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: '#ffffff',
    cursor: 'pointer',
    fontSize: '14px',
  },
  primaryButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#007bff',
    color: '#ffffff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  canvasContainer: {
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'auto',
    padding: '16px',
  },
  canvas: {
    maxWidth: '100%',
    maxHeight: '100%',
    border: '2px solid #ccc',
    cursor: 'crosshair',
    backgroundColor: '#ffffff',
  },
};

export default AnnotationCanvas;
