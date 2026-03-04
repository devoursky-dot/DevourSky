// SmartBoard_hooks.js
import { useState, useRef, useCallback, useEffect } from 'react';

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

// --- 메인 커스텀 훅 ---
export const useSmartBoard = () => {
  // 상태(State) 관리
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfImage, setPdfImage] = useState(null);
  const [lines, setLines] = useState([]);
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

  // 참조(Ref) 관리
  const stageRef = useRef(null);
  const isDrawing = useRef(false);
  const lastDist = useRef(0);
  const lastCenter = useRef(null);
  const linesRef = useRef(lines);
  const smartTimer = useRef(null); 
  const isSmartShapeFixed = useRef(false); 
  const lastPressureRef = useRef({ time: 0, x: 0, y: 0, velocity: 0, width: 0 });

  const activePen = pens[activePenId];

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

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
    setPdfImage(null);
    setPdfFile(fileOrBlob);
    setCurrPage(1);
  }, []);

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
      setPdfImage(null);
    }
    setCurrPage(pageNumber);
    setShowPageSelector(false);
    setLines([]);
    setHistory([[]]); 
    setHistoryStep(0);
    setStageScale(1);
    setStagePos({ x: 0, y: 0 });
  }, [currPage]);

  const handlePrevPage = useCallback(() => {
    if (currPage > 1) changePage(currPage - 1);
  }, [currPage, changePage]);

  const handleNextPage = useCallback(() => {
    if (numPages && currPage < numPages) changePage(currPage + 1);
  }, [currPage, numPages, changePage]);

  const onRenderSuccess = useCallback(async (page) => {
    const renderScale = 3.0; 
    const viewport = page.getViewport({ scale: renderScale });
    
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    
    // 배경을 흰색으로 채움 (투명 배경 PDF가 검게 나오는 문제 방지)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    await page.render({ canvasContext: ctx, viewport, intent: 'display' }).promise;
    
    setBgColor('#ffffff'); // 항상 깨끗한 흰색 배경으로 고정

    // Canvas 객체를 직접 이미지 소스로 사용 (변환 과정 생략으로 안정성 확보)
    setPdfImage(canvas);
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

    setLines(prev => [...prev, newLine]);
  }, [tool, activePen]);

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

      setLines(prev => {
        const lastLine = { ...prev[prev.length - 1] };
        lastLine.points = lastLine.points.concat([point.x, point.y]);
        if (!lastLine.widths) lastLine.widths = [baseWidth];
        lastLine.widths = lastLine.widths.concat([width]);
        
        return [...prev.slice(0, -1), lastLine];
      });
      return;
    }

    if (tool === 'pen' && activePen.type === 'smart' && isDrawing.current) {
      if (isSmartShapeFixed.current) return; 

      setLines(prev => {
        const lastLine = { ...prev[prev.length - 1] };
        lastLine.points = lastLine.points.concat([point.x, point.y]);
        return [...prev.slice(0, -1), lastLine];
      });

      if (smartTimer.current) clearTimeout(smartTimer.current);
      smartTimer.current = setTimeout(() => {
        setLines(prev => {
          const lastIndex = prev.length - 1;
          const lastLine = prev[lastIndex];
          if (!lastLine || lastLine.penType !== 'smart' || lastLine.points.length < 4) return prev;

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
          return [...prev.slice(0, -1), newLine];
        });
        isSmartShapeFixed.current = true; 
      }, 600);
      return;
    }

    if (isDrawing.current) {
      setLines(prev => {
        const lastLine = { ...prev[prev.length - 1] };
        lastLine.points = lastLine.points.concat([point.x, point.y]);
        return [...prev.slice(0, -1), lastLine];
      });
    }
  }, [tool, currentCrop, activePen]);

  const handleMouseUp = useCallback(() => { 
    if (tool === 'crop' && currentCrop) {
      const { x, y, width, height } = currentCrop;
      if (width > 5 && height > 5) {
        const huge = 100000;
        const maskRects = [
          { tool: 'rect', x: -huge, y: -huge, width: huge * 2, height: huge + y, fill: bgColor },
          { tool: 'rect', x: -huge, y: y + height, width: huge * 2, height: huge, fill: bgColor },
          { tool: 'rect', x: -huge, y: y, width: huge + x, height: height, fill: bgColor },
          { tool: 'rect', x: x + width, y: y, width: huge, height: height, fill: bgColor }
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
      addToHistory(linesRef.current);
      return;
    }

    if (isDrawing.current) {
      isDrawing.current = false;
      addToHistory(linesRef.current);
    }
  }, [tool, currentCrop, bgColor, addToHistory, activePen]);

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
    pdfFile, pdfImage, lines, tool, setTool, pens, activePenId, setActivePenId,
    stageScale, stagePos, setStagePos, bgColor, currentCrop, isFullScreen,
    numPages, currPage, showPageSelector, setShowPageSelector, stageRef, activePen,
    updateActivePen, toggleFullScreen, handleFileChange, onDocumentLoadSuccess,
    changePage, handlePrevPage, handleNextPage, onRenderSuccess,
    handleMouseDown, handleMouseMove, handleMouseUp,
    handleTouchStart, handleTouchMove, handleTouchEnd,
    handleWheel, handleZoomChange, handleResetZoom, hasMask, handleCropTool, 
    handleClearAll, loadPdf, // loadPdf 내보내기 추가
    undo, redo, canUndo: historyStep > 0, canRedo: historyStep < history.length - 1
  };
};