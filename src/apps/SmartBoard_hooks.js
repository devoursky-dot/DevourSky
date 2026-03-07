// SmartBoard_hooks.js
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

// 색상 팔레트 (앱 전체에서 공유)
export const colorPalette = [
  '#000000', '#333333', '#666666', '#999999', '#FFFFFF',
  '#FF0000', '#FFA500', '#FFFF00', '#008000', '#0000FF',
  '#4B0082', '#800080', '#FFC0CB', '#A52A2A', '#00FFFF',
  '#008080', '#000080', '#808000', '#800000', '#FF00FF'
];

// --- [설정] 속도 기반 필압 상수 ---
const VELOCITY_PARAMS = {
  minSpeed: 0.05,       
  maxSpeed: 1.5,       
  minWidthRatio: 0.2,  
  maxWidthRatio: 1.2,  
  smoothing: 0.1       
};

// [OPTIMIZATION] Reduced from 8 to 4 to halve JavaScript interpolation workload
const SPLINE_QUALITY = 4;

// --- 헬퍼 함수 ---
const getRelativePointerPosition = (stage) => {
  const transform = stage.getAbsoluteTransform().copy().invert();
  const pos = stage.getPointerPosition();
  return transform.point(pos);
};

const getDistance = (p1, p2) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

const getCenter = (p1, p2) => ({
  x: (p1.x + p2.x) / 2,
  y: (p1.y + p2.y) / 2,
});

const catmullRom = (p0, p1, p2, p3, t) => {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  const t3 = t * t2;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
};

// --- Ramer-Douglas-Peucker 알고리즘 (곡선 단순화) ---
const getSqSegDist = (p, p1, p2) => {
  let x = p1.x, y = p1.y;
  let dx = p2.x - x, dy = p2.y - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2.x; y = p2.y;
    } else if (t > 0) {
      x += dx * t; y += dy * t;
    }
  }
  dx = p.x - x; dy = p.y - y;
  return dx * dx + dy * dy;
};

function simplifyDPStep(points, first, last, sqTolerance, simplified) {
  let maxSqDist = sqTolerance;
  let index = -1;
  for (let i = first + 1; i < last; i++) {
    const sqDist = getSqSegDist(points[i], points[first], points[last]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }
  if (maxSqDist > sqTolerance) {
    if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
    simplified.push(points[index]);
    if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
  }
}

const simplifyPoints = (points, tolerance) => {
  if (points.length <= 4) return points;
  const sqTolerance = tolerance * tolerance;
  const pts = [];
  for (let i = 0; i < points.length; i += 2) {
    pts.push({ x: points[i], y: points[i + 1] });
  }
  const simplified = [pts[0]];
  simplifyDPStep(pts, 0, pts.length - 1, sqTolerance, simplified);
  simplified.push(pts[pts.length - 1]);
  
  const result = [];
  simplified.forEach(p => result.push(p.x, p.y));
  return result;
};

// --- 캔버스 드로잉 헬퍼 (PressureLine 로직 이식) ---
const drawLineOnCanvas = (ctx, line) => {
  if (!line.points || line.points.length < 2) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = line.opacity || 1;
  
  // 지우개 처리
  if (line.color === 'white' || line.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)'; // 지우개는 색상 무관, 알파만 중요
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = line.color;
    ctx.fillStyle = line.color;
  }

  // 1. 일반 펜 / 형광펜 / 직선 / 스마트 도형
  if (line.penType !== 'pressure' || line.tool !== 'pen') {
    ctx.lineWidth = line.strokeWidth;
    ctx.beginPath();
    ctx.moveTo(line.points[0], line.points[1]);
    for (let i = 2; i < line.points.length; i += 2) {
      ctx.lineTo(line.points[i], line.points[i + 1]);
    }
    // 스마트 도형(closed) 처리
    if (line.tool === 'rect' || line.tool === 'ellipse') {
      // Rect/Ellipse는 별도 객체로 처리하므로 여기서는 패스 (혹은 필요시 구현)
      return; 
    }
    ctx.stroke();
    return;
  }

  // 2. 필압 펜 (Pressure Pen) - Spline Interpolation (원래대로 복구)
  const points = line.points;
  const widths = line.widths || [];
  const numPoints = points.length / 2;
  if (numPoints < 2) return;

  const getW = (idx) => {
    if (idx < 0) return widths[0];
    if (idx >= widths.length) return widths[widths.length - 1];
    return widths[idx];
  };

  // 보간된 점들을 저장할 배열
  const interpolatedPoints = [];
  const interpolatedWidths = [];

  for (let i = 0; i < numPoints - 1; i++) {
    const p0x = i === 0 ? points[0] : points[(i - 1) * 2];
    const p0y = i === 0 ? points[1] : points[(i - 1) * 2 + 1];
    const p1x = points[i * 2];
    const p1y = points[i * 2 + 1];
    const p2x = points[(i + 1) * 2];
    const p2y = points[(i + 1) * 2 + 1];
    const p3x = i === numPoints - 2 ? p2x : points[(i + 2) * 2];
    const p3y = i === numPoints - 2 ? p2y : points[(i + 2) * 2 + 1];

    const w0 = getW(i - 1);
    const w1 = getW(i);
    const w2 = getW(i + 1);
    const w3 = getW(i + 2);

    for (let j = 0; j < SPLINE_QUALITY; j++) {
      const t = j / SPLINE_QUALITY;
      const x = catmullRom(p0x, p1x, p2x, p3x, t);
      const y = catmullRom(p0y, p1y, p2y, p3y, t);
      const w = catmullRom(w0, w1, w2, w3, t);
      interpolatedPoints.push({ x, y });
      interpolatedWidths.push(Math.max(0.1, w));
    }
  }
  // 마지막 점 추가
  interpolatedPoints.push({ x: points[points.length - 2], y: points[points.length - 1] });
  interpolatedWidths.push(getW(widths.length - 1));

  // 외곽선 그리기
  ctx.beginPath();
  const leftPath = [];
  const rightPath = [];

  for (let i = 0; i < interpolatedPoints.length; i++) {
    const p = interpolatedPoints[i];
    const w = interpolatedWidths[i];
    // 다음 점과의 각도 계산 (마지막 점은 이전 점 사용)
    const nextP = interpolatedPoints[i + 1] || interpolatedPoints[i];
    const prevP = interpolatedPoints[i - 1] || interpolatedPoints[i];
    const angle = Math.atan2(nextP.y - prevP.y, nextP.x - prevP.x);
    
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    
    leftPath.push({ x: p.x + sin * w / 2, y: p.y - cos * w / 2 });
    rightPath.push({ x: p.x - sin * w / 2, y: p.y + cos * w / 2 });
  }

  // 경로 연결
  if (leftPath.length > 0) {
    ctx.moveTo(leftPath[0].x, leftPath[0].y);
    for (let i = 1; i < leftPath.length; i++) ctx.lineTo(leftPath[i].x, leftPath[i].y);
    for (let i = rightPath.length - 1; i >= 0; i--) ctx.lineTo(rightPath[i].x, rightPath[i].y);
    ctx.closePath();
    ctx.fill();
  }
  
  if (line.color === 'white' || line.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = line.color;
  }
};

// --- 메인 커스텀 훅 ---
export const useSmartBoard = () => {
  // 1. All useState Hooks
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfImage, setPdfImage] = useState(null);
  const [lines, setLines] = useState([]);
  const [rasterCanvas, setRasterCanvas] = useState(null); 
  const [activeCanvas, setActiveCanvas] = useState(null); 

  // 2. Interleaved Refs (Match previous order)
  const activeLayerRef = useRef(null); 
  const currentLineRef = useRef(null);

  // 3. More states
  const [history, setHistory] = useState([[]]); 
  const [historyStep, setHistoryStep] = useState(0); 
  const [tool, setTool] = useState('pen');
  const [pens, setPens] = useState([
    { type: 'basic', color: '#000000', width: 3 },
    { type: 'basic', color: '#FF0000', width: 3 }
  ]);
  const [activePenId, setActivePenId] = useState(0);
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [bgColor, setBgColor] = useState('#ffffff');
  const [currentCrop, setCurrentCrop] = useState(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [numPages, setNumPages] = useState(null);
  const [currPage, setCurrPage] = useState(1);
  const [showPageSelector, setShowPageSelector] = useState(false);
  const [isDrawingNow, setIsDrawingNow] = useState(false); 
  const [pdfLoading, setPdfLoading] = useState(false);

  // 4. More Refs
  const stageRef = useRef(null);
  const isDrawing = useRef(false);
  const lastDist = useRef(0);
  const lastCenter = useRef(null);
  const linesRef = useRef(lines);
  const smartTimer = useRef(null); 
  const isSmartShapeFixed = useRef(false); 
  const lastPressureRef = useRef({ time: 0, x: 0, y: 0, velocity: 0, width: 0 });
  const pageCanvasRef = useRef(null); // [추가] 내부 렌더링용 캔버스 참조

  const activePen = pens[activePenId];

  // [추가] 래스터 캔버스 초기화
  useEffect(() => {
    const canvas = document.createElement('canvas');
    // 캔버스 크기는 충분히 크게 잡거나 PDF 크기에 맞춤 (여기서는 FHD 기준 2배수로 설정하여 고해상도 대응)
    canvas.width = 3840; 
    canvas.height = 2160;
    setRasterCanvas(canvas);
  }, []);

  // [추가] 활성 캔버스 초기화
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 3840;
    canvas.height = 2160;
    setActiveCanvas(canvas);
  }, []);

  // [추가] 히스토리 변경 시 캔버스 다시 그리기 (Undo/Redo)
  useEffect(() => {
    linesRef.current = lines;
    if (rasterCanvas) {
      // [OPTIMIZATION] desynchronized hint
      const ctx = rasterCanvas.getContext('2d', { desynchronized: true });
      ctx.clearRect(0, 0, rasterCanvas.width, rasterCanvas.height);
      
      lines.forEach(line => {
        // 마스크(Rect)나 도형 등은 캔버스에 그리지 않고 벡터로 남길 수 있음
        // 여기서는 펜 스트로크만 캔버스에 굽습니다.
        if (line.tool !== 'rect' && line.tool !== 'ellipse' && line.tool !== 'smart_path') {
          drawLineOnCanvas(ctx, line);
        }
      });
      
      // Konva Image 갱신을 위해 캔버스 참조 업데이트 (꼼수: 상태를 살짝 건드려 리렌더링 유도할 수도 있음)
      // 하지만 React-Konva의 Image 컴포넌트는 canvas 객체가 같으면 리렌더링 안할 수 있음.
      // 상위 컴포넌트에서 layer.batchDraw()가 필요할 수 있음.
    }
  }, [lines, rasterCanvas]);

  useEffect(() => {
    const handleFullScreenChange = () => setIsFullScreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
  }, []);

  const addToHistory = useCallback((newLines) => {
    const newHistory = history.slice(0, historyStep + 1); 
    newHistory.push(newLines);
    setHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
  }, [history, historyStep]);

  const undo = useCallback(() => {
    if (historyStep > 0) {
      const newStep = historyStep - 1;
      setHistoryStep(newStep);
      setLines(history[newStep]);
    }
  }, [history, historyStep]);

  const redo = useCallback(() => {
    if (historyStep < history.length - 1) {
      const newStep = historyStep + 1;
      setHistoryStep(newStep);
      setLines(history[newStep]);
    }
  }, [history, historyStep]);

  const updateActivePen = useCallback((updates) => {
    setPens(prev => prev.map((p, i) => i === activePenId ? { ...p, ...updates } : p));
  }, [activePenId]);

  const toggleFullScreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }, []);

  // [추가] 외부(구글 드라이브 등)에서 가져온 Blob 데이터를 로드하는 함수
  const loadPdf = useCallback((fileOrBlob) => {
    setPdfLoading(true);
    // [OPTIMIZATION] 기존 캔버스 메모리 강제 해제 시도
    if (pdfImage instanceof HTMLCanvasElement) {
      pdfImage.width = 0;
      pdfImage.height = 0;
    }
    setPdfImage(null);
    setPdfFile(fileOrBlob);
    setCurrPage(1);
  }, [pdfImage]);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files[0];
    if (file) {
      loadPdf(file);
    }
  }, [loadPdf]);

  const onDocumentLoadSuccess = useCallback(({ numPages }) => {
    setNumPages(numPages);
    setShowPageSelector(true);
  }, []);

  const changePage = useCallback((pageNumber) => {
    if (pageNumber !== currPage) {
      setPdfLoading(true);
      // [OPTIMIZATION] 기존 캔버스 메모리 강제 해제 시도 (고해상도 비트맵 대응)
      if (pdfImage instanceof HTMLCanvasElement) {
        pdfImage.width = 0;
        pdfImage.height = 0;
      }
      setPdfImage(null);
    }
    setCurrPage(pageNumber);
    setShowPageSelector(false);
    setLines([]);
    setHistory([[]]); 
    setHistoryStep(0);
    setStageScale(1);
    setStagePos({ x: 0, y: 0 });
    if (rasterCanvas) {
      const ctx = rasterCanvas.getContext('2d', { desynchronized: true });
      ctx.clearRect(0, 0, rasterCanvas.width, rasterCanvas.height);
    }
  }, [currPage, pdfImage, rasterCanvas]);

  const handlePrevPage = useCallback(() => {
    if (currPage > 1) changePage(currPage - 1);
  }, [currPage, changePage]);

  const handleNextPage = useCallback(() => {
    if (numPages && currPage < numPages) changePage(currPage + 1);
  }, [currPage, numPages, changePage]);

  // [추가] React-PDF가 내부적으로 렌더링한 캔버스를 캡처하는 함수 (매우 안정적)
  const onPageRender = useCallback(() => {
    try {
      // canvasRef를 통해 전달받은 엘리먼트를 직접 사용합니다.
      const canvas = pageCanvasRef.current;
      
      if (canvas instanceof HTMLCanvasElement && canvas.width > 0) {
        // [OPTIMIZATION] Konva 성능과 메모리 분리를 위해 캔버스를 복제하여 사용
        const newCanvas = document.createElement('canvas');
        newCanvas.width = canvas.width;
        newCanvas.height = canvas.height;
        const ctx = newCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        
        setPdfImage(newCanvas);
        console.log("PDF Canvas captured successfully via Ref:", newCanvas.width, "x", newCanvas.height);
      } else {
        console.warn("PDF Canvas capture failed: canvas not found or invalid.");
      }
    } catch (err) {
      console.error("Failed to capture PDF canvas:", err);
    } finally {
      setPdfLoading(false);
    }
  }, []);

  const onRenderSuccess = useCallback(() => {
    // [INFO] 실제 캔버스 캡처는 onPageRender에서 수행하거나, 
    // 여기서 DOM을 뒤져서 가져올 수도 있습니다.
    // 여기서는 로딩 상태 해제 보완용으로 사용합니다.
    setPdfLoading(false);
  }, []);

  const handleMouseDown = useCallback((e) => {
    const stage = e.target.getStage();
    const pos = getRelativePointerPosition(stage);

    if (tool === 'hand') return;
    if (tool === 'crop') {
      setCurrentCrop({ x: pos.x, y: pos.y, width: 0, height: 0, startX: pos.x, startY: pos.y });
      return;
    }
    
    if (tool === 'pen' && activePen.type === 'smart') {
      isDrawing.current = true;
      isSmartShapeFixed.current = false;
    }

    isDrawing.current = true;
    
    if (tool === 'pen' && activePen.type === 'pressure') {
      lastPressureRef.current = {
        time: Date.now(),
        x: pos.x,
        y: pos.y,
        velocity: 0,
        width: activePen.width
      };
    }

    let newLine = { 
      tool, 
      points: [pos.x, pos.y], 
      color: tool === 'eraser' ? 'white' : activePen.color,
      strokeWidth: tool === 'eraser' ? 30 : activePen.width,
      opacity: tool === 'pen' && activePen.type === 'highlighter' ? 0.4 : 1,
      penType: tool === 'pen' ? activePen.type : 'basic',
      widths: (tool === 'pen' && activePen.type === 'pressure') ? [activePen.width] : undefined
    };

    currentLineRef.current = newLine; // [변경] State 대신 Ref 업데이트

    // [OPTIMIZATION] 선을 긋기 시작함을 UI에 알림 (렌더링은 이 때와 마우스 뗐을 때 두 번만 발생)
    if (tool === 'pen' || tool === 'eraser') {
      setIsDrawingNow(true);
    }

    // 활성 캔버스 초기화
    if (activeCanvas) {
      // [OPTIMIZATION] desynchronized hint
      const ctx = activeCanvas.getContext('2d', { desynchronized: true });
      ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
    }
  }, [tool, activePen, activeCanvas]);

  const handleMouseMove = useCallback((e) => {
    if (tool === 'hand') return;
    const stage = e.target.getStage();
    const point = getRelativePointerPosition(stage);

    if (tool === 'crop' && currentCrop) {
      setCurrentCrop(prev => ({
        ...prev,
        x: Math.min(prev.startX, point.x),
        y: Math.min(prev.startY, point.y),
        width: Math.abs(point.x - prev.startX),
        height: Math.abs(point.y - prev.startY)
      }));
      return;
    }

    if (tool === 'pen' && activePen.type === 'pressure' && isDrawing.current) {
      const now = Date.now();
      const last = lastPressureRef.current;
      const dist = Math.sqrt(Math.pow(point.x - last.x, 2) + Math.pow(point.y - last.y, 2));

      if (dist < 2 && (now - last.time) < 50) return;

      const dt = Math.max(1, now - last.time); 
      const currVelocity = dist / dt;

      const velocity = last.velocity * VELOCITY_PARAMS.smoothing + currVelocity * (1 - VELOCITY_PARAMS.smoothing);

      const { minSpeed, maxSpeed, minWidthRatio, maxWidthRatio } = VELOCITY_PARAMS;
      const clampedVel = Math.max(minSpeed, Math.min(velocity, maxSpeed));
      const ratio = (clampedVel - minSpeed) / (maxSpeed - minSpeed);
      
      const baseWidth = activePen.width;
      const minW = baseWidth * minWidthRatio;
      const maxW = baseWidth * maxWidthRatio;
      
      const targetWidth = maxW - ratio * (maxW - minW);

      const width = last.width * VELOCITY_PARAMS.smoothing + targetWidth * (1 - VELOCITY_PARAMS.smoothing);

      lastPressureRef.current = { time: now, x: point.x, y: point.y, velocity, width };

      if (currentLineRef.current) {
        const line = currentLineRef.current;
        line.points.push(point.x, point.y);
        if (!line.widths) line.widths = [baseWidth];
        line.widths.push(width);

        if (activeCanvas) {
          const ctx = activeCanvas.getContext('2d', { desynchronized: true });
          
          // [OPTIMIZATION] Bounded clearRect to avoid full 4K clear on every point
          if (line.points.length >= 4) {
            let minX = line.points[0], maxX = minX;
            let minY = line.points[1], maxY = minY;
            for(let i=2; i<line.points.length; i+=2) {
              if (line.points[i] < minX) minX = line.points[i];
              if (line.points[i] > maxX) maxX = line.points[i];
              if (line.points[i+1] < minY) minY = line.points[i+1];
              if (line.points[i+1] > maxY) maxY = line.points[i+1];
            }
            const pad = 50; // Add generous padding to ensure we fully clear thick lines and splines
            ctx.clearRect(Math.max(0, minX - pad), Math.max(0, minY - pad), (maxX - minX) + pad*2, (maxY - minY) + pad*2);
          } else {
             ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
          }

          drawLineOnCanvas(ctx, line);
          if (activeLayerRef.current) activeLayerRef.current.batchDraw();
        }
      }
      return;
    }

    if (tool === 'pen' && activePen.type === 'smart' && isDrawing.current) {
      if (isSmartShapeFixed.current) return; 

      if (currentLineRef.current) {
        const line = currentLineRef.current;
        line.points.push(point.x, point.y);
        
        if (activeCanvas) {
          const ctx = activeCanvas.getContext('2d', { desynchronized: true });
          // [OPTIMIZATION] Bounded clearRect
          if (line.points.length >= 4) {
            let minX = line.points[0], maxX = minX;
            let minY = line.points[1], maxY = minY;
            for(let i=2; i<line.points.length; i+=2) {
              if (line.points[i] < minX) minX = line.points[i];
              if (line.points[i] > maxX) maxX = line.points[i];
              if (line.points[i+1] < minY) minY = line.points[i+1];
              if (line.points[i+1] > maxY) maxY = line.points[i+1];
            }
            const pad = 50; 
            ctx.clearRect(Math.max(0, minX - pad), Math.max(0, minY - pad), (maxX - minX) + pad*2, (maxY - minY) + pad*2);
          } else {
            ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
          }

          drawLineOnCanvas(ctx, line);
          if (activeLayerRef.current) activeLayerRef.current.batchDraw();
        }
      }

      if (smartTimer.current) clearTimeout(smartTimer.current);
      smartTimer.current = setTimeout(() => {
        if (!currentLineRef.current || currentLineRef.current.penType !== 'smart' || currentLineRef.current.points.length < 4) return;
        
        const lastLine = currentLineRef.current;

          const pts = lastLine.points;
          const start = { x: pts[0], y: pts[1] };
          const end = { x: pts[pts.length - 2], y: pts[pts.length - 1] };
          
          const dist = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
          let totalLen = 0;
          for(let i=0; i<pts.length-2; i+=2) totalLen += Math.sqrt(Math.pow(pts[i+2]-pts[i], 2) + Math.pow(pts[i+3]-pts[i+1], 2));

          const straightness = dist / totalLen;
          const newTool = straightness > 0.98 ? 'line_straight' : 'smart_curve'; 
          
          let newPoints = pts;
          if (newTool === 'smart_curve') {
            newPoints = simplifyPoints(pts, 2.0);
          }

          const newLine = { ...lastLine, tool: newTool, tension: newTool === 'smart_curve' ? 0.5 : 0, points: newTool === 'line_straight' ? [start.x, start.y, end.x, end.y] : newPoints };
          
          currentLineRef.current = newLine;
          
          if (activeCanvas) {
            const ctx = activeCanvas.getContext('2d', { desynchronized: true });
            ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
            drawLineOnCanvas(ctx, newLine);
            if (activeLayerRef.current) activeLayerRef.current.batchDraw();
          }

        isSmartShapeFixed.current = true; 
      }, 600);
      return;
    }

    if (isDrawing.current) {
      if (currentLineRef.current) {
        const line = currentLineRef.current;
        line.points.push(point.x, point.y);
        if (activeCanvas) {
          const ctx = activeCanvas.getContext('2d', { desynchronized: true });
          
          if (line.points.length >= 4) {
             let minX = line.points[0], maxX = minX;
             let minY = line.points[1], maxY = minY;
             for(let i=2; i<line.points.length; i+=2) {
               if (line.points[i] < minX) minX = line.points[i];
               if (line.points[i] > maxX) maxX = line.points[i];
               if (line.points[i+1] < minY) minY = line.points[i+1];
               if (line.points[i+1] > maxY) maxY = line.points[i+1];
             }
             const pad = 50;
             ctx.clearRect(Math.max(0, minX - pad), Math.max(0, minY - pad), (maxX - minX) + pad*2, (maxY - minY) + pad*2);
          } else {
             ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
          }

          drawLineOnCanvas(ctx, line);
          if (activeLayerRef.current) activeLayerRef.current.batchDraw();
        }
      }
    }
  }, [tool, currentCrop, activePen, activeCanvas]);

  const handleMouseUp = useCallback(() => { 
    if (tool === 'crop' && currentCrop) {
      const { x, y, width, height } = currentCrop;
      if (width > 5 && height > 5) {
        const huge = 100000;
        const maskRects = [
          { tool: 'rect', x: -huge, y: -huge, width: huge * 2, height: huge + y, fill: bgColor, isMask: true },
          { tool: 'rect', x: -huge, y: y + height, width: huge * 2, height: huge, fill: bgColor, isMask: true },
          { tool: 'rect', x: -huge, y: y, width: huge + x, height: height, fill: bgColor, isMask: true },
          { tool: 'rect', x: x + width, y: y, width: huge, height: height, fill: bgColor, isMask: true }
        ];
        const newLines = [...linesRef.current, ...maskRects];
        setLines(newLines);
        addToHistory(newLines);
      }
      setCurrentCrop(null);
      setTool('pen');
      return;
    }
    
    if (tool === 'pen' && activePen.type === 'smart') {
      if (smartTimer.current) clearTimeout(smartTimer.current);
      isDrawing.current = false;
      isSmartShapeFixed.current = false;
      
      if (currentLineRef.current) {
        const newLines = [...lines, currentLineRef.current];
        setLines(newLines);
        addToHistory(newLines);
        currentLineRef.current = null;
        if (activeCanvas) {
          const ctx = activeCanvas.getContext('2d', { desynchronized: true });
          ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
          if (activeLayerRef.current) activeLayerRef.current.batchDraw();
        }
      }
      setIsDrawingNow(false); // [추가] UI 투명화 해제
      return;
    }

    if (isDrawing.current) {
      isDrawing.current = false;
      if (currentLineRef.current) {
        const newLines = [...lines, currentLineRef.current];
        setLines(newLines);
        addToHistory(newLines);
        currentLineRef.current = null;
        if (activeCanvas) {
          const ctx = activeCanvas.getContext('2d', { desynchronized: true });
          ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
          if (activeLayerRef.current) activeLayerRef.current.batchDraw();
        }
      }
    }
    setIsDrawingNow(false); // [추가] UI 투명화 해제
  }, [tool, currentCrop, bgColor, addToHistory, activePen, lines, activeCanvas]);

  const handleWheel = useCallback((e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if(!stage) return;
    const oldScale = stage.scaleX();
    const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const speed = 1.15;
    let newScale = e.evt.deltaY > 0 ? oldScale / speed : oldScale * speed;
    newScale = Math.max(0.2, Math.min(newScale, 5));

    setStageScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }, []);

  const handleZoomChange = useCallback((newScale) => {
    const stage = stageRef.current;
    if (stage) {
      const oldScale = stage.scaleX();
      const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };
      setStageScale(newScale);
      setStagePos({
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      });
    } else {
      setStageScale(newScale);
    }
  }, []);

  const handleResetZoom = useCallback(() => {
    setStageScale(1);
    setStagePos({x:0, y:0});
  }, []);

  const handleTouchStart = useCallback((e) => {
    if (e.evt.touches.length === 1) {
      handleMouseDown(e);
    } else if (e.evt.touches.length === 2) {
      const stage = stageRef.current;
      if (stage && tool === 'hand') {
        stage.stopDrag();
        stage.draggable(false);
      }
      isDrawing.current = false;
      const p1 = { x: e.evt.touches[0].clientX, y: e.evt.touches[0].clientY };
      const p2 = { x: e.evt.touches[1].clientX, y: e.evt.touches[1].clientY };
      lastDist.current = getDistance(p1, p2);
      lastCenter.current = getCenter(p1, p2);
    }
  }, [handleMouseDown, tool]);

  const handleTouchMove = useCallback((e) => {
    if (e.evt.touches.length === 1) {
      handleMouseMove(e);
    } else if (e.evt.touches.length === 2) {
      e.evt.preventDefault();
      const p1 = { x: e.evt.touches[0].clientX, y: e.evt.touches[0].clientY };
      const p2 = { x: e.evt.touches[1].clientX, y: e.evt.touches[1].clientY };
      if (!lastCenter.current) return;

      const newDist = getDistance(p1, p2);
      const newCenter = getCenter(p1, p2);
      const distRatio = newDist / lastDist.current;

      const stage = stageRef.current;
      const oldScale = stage.scaleX();
      let newScale = Math.max(0.2, Math.min(oldScale * distRatio, 5));

      const mousePointTo = {
        x: (lastCenter.current.x - stage.x()) / oldScale,
        y: (lastCenter.current.y - stage.y()) / oldScale,
      };

      setStageScale(newScale);
      setStagePos({
        x: newCenter.x - mousePointTo.x * newScale,
        y: newCenter.y - mousePointTo.y * newScale,
      });

      lastDist.current = newDist;
      lastCenter.current = newCenter;
    }
  }, [handleMouseMove]);

  const handleTouchEnd = useCallback((e) => {
    lastDist.current = 0;
    lastCenter.current = null;
    const stage = stageRef.current;
    if (stage && tool === 'hand') stage.draggable(true);
    handleMouseUp(e);
  }, [handleMouseUp, tool]);

  const hasMask = lines.some(line => line.tool === 'rect');
  
  const handleCropTool = useCallback(() => {
    const isMasked = linesRef.current.some(line => line.tool === 'rect');
    if (isMasked) {
      setLines(prev => prev.filter(line => line.tool !== 'rect'));
      setTool('pen');
    } else {
      setTool(prev => prev === 'crop' ? 'pen' : 'crop');
    }
  }, []);

  const handleClearAll = useCallback(() => {
    const maskLines = linesRef.current.filter(line => line.tool === 'rect');
    setLines(maskLines);
    if (smartTimer.current) clearTimeout(smartTimer.current);
    addToHistory(maskLines); 
  }, [addToHistory]);

  return {
    pdfFile, pdfImage, lines, rasterCanvas, activeCanvas, activeLayerRef, tool, setTool, pens, activePenId, setActivePenId,
    stageScale, stagePos, setStagePos, bgColor, currentCrop, isFullScreen,
    numPages, currPage, showPageSelector, setShowPageSelector, stageRef, pageCanvasRef, activePen,
    updateActivePen, toggleFullScreen, handleFileChange, onDocumentLoadSuccess,
    changePage, handlePrevPage, handleNextPage, onRenderSuccess, onPageRender,
    handleMouseDown, handleMouseMove, handleMouseUp,
    handleTouchStart, handleTouchMove, handleTouchEnd,
    handleWheel, handleZoomChange, handleResetZoom, hasMask, handleCropTool, 
    handleClearAll, loadPdf,
    undo, redo, canUndo: historyStep > 0, canRedo: historyStep < history.length - 1,
    isDrawingNow,
    pdfLoading
  };
};