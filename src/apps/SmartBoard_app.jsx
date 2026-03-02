// SmartBoard_app.jsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Stage, Layer, Image, Rect, Line, Ellipse, Path, Shape } from 'react-konva';
import { Document, Page, pdfjs } from 'react-pdf';
import { FileUp, Hand, Pencil, Eraser, RotateCcw, Crop, Maximize, Minimize, Highlighter, PenTool, LayoutGrid, ChevronLeft, ChevronRight, Trash2, Undo, Redo, Sparkles, Folder, X } from 'lucide-react';
import { useSmartBoard, colorPalette } from './SmartBoard_hooks'; 

try {
  if (typeof pdfjs !== 'undefined' && pdfjs.version) {
    pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }
} catch (e) {
  console.warn("PDF Worker setup failed:", e);
}

// --- [설정] 구글 드라이브 API 및 폴더 설정 ---
const GOOGLE_API_KEY = 'AIzaSyCiVnPpyg9xkhkiacbFmkE05tjy4Z7omko'; 
const GOOGLE_FOLDER_ID = '1dfp2p0z9QhpDf5Koz3gHL2glKTkXoDIq'; 

const SPLINE_QUALITY = 8; 

const catmullRom = (p0, p1, p2, p3, t) => {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  const t3 = t * t2;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
};

const getWidth = (widths, index) => {
  if (!widths || widths.length === 0) return 1;
  if (index < 0) return widths[0];
  if (index >= widths.length) return widths[widths.length - 1];
  return widths[index];
};

const PressureLine = ({ points, widths, color }) => (
  <Shape
    sceneFunc={(ctx, shape) => {
      if (!points || points.length < 4 || !widths || widths.length === 0) return;
      
      try {
      ctx.beginPath();

      const numPoints = points.length / 2;
      if (numPoints < 2) return;

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

        const w0 = getWidth(widths, i - 1);
        const w1 = getWidth(widths, i);
        const w2 = getWidth(widths, i + 1);
        const w3 = getWidth(widths, i + 2);

        for (let j = 0; j < SPLINE_QUALITY; j++) {
          const t = j / SPLINE_QUALITY;
          const x = catmullRom(p0x, p1x, p2x, p3x, t);
          const y = catmullRom(p0y, p1y, p2y, p3y, t);
          const w = catmullRom(w0, w1, w2, w3, t);

          if (isNaN(x) || isNaN(y) || isNaN(w)) continue; 
          
          interpolatedPoints.push({ x, y });
          interpolatedWidths.push(Math.max(0.1, w)); 
        }
      }
      
      interpolatedPoints.push({ x: points[points.length - 2], y: points[points.length - 1] });
      interpolatedWidths.push(getWidth(widths, widths.length - 1));

      const leftPath = [];
      const rightPath = [];

      for (let i = 0; i < interpolatedPoints.length - 1; i++) {
        const p1 = interpolatedPoints[i];
        const p2 = interpolatedPoints[i + 1];
        const w = interpolatedWidths[i];

        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);

        leftPath.push({ x: p1.x + sin * w / 2, y: p1.y - cos * w / 2 });
        rightPath.push({ x: p1.x - sin * w / 2, y: p1.y + cos * w / 2 });
      }

      const lastIdx = interpolatedPoints.length - 1;
      const lastP = interpolatedPoints[lastIdx];
      const lastW = interpolatedWidths[lastIdx];
      const prevP = interpolatedPoints[lastIdx - 1];
      
      if (prevP) {
        const angle = Math.atan2(lastP.y - prevP.y, lastP.x - prevP.x);
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);
        leftPath.push({ x: lastP.x + sin * lastW / 2, y: lastP.y - cos * lastW / 2 });
        rightPath.push({ x: lastP.x - sin * lastW / 2, y: lastP.y + cos * lastW / 2 });
      }

      if (leftPath.length > 0) {
        ctx.moveTo(leftPath[0].x, leftPath[0].y);
        for (let i = 1; i < leftPath.length; i++) {
          ctx.lineTo(leftPath[i].x, leftPath[i].y);
        }
        
        ctx.arc(lastP.x, lastP.y, lastW / 2, Math.atan2(lastP.y - prevP.y, lastP.x - prevP.x) - Math.PI / 2, Math.atan2(lastP.y - prevP.y, lastP.x - prevP.x) + Math.PI / 2);

        for (let i = rightPath.length - 1; i >= 0; i--) {
          ctx.lineTo(rightPath[i].x, rightPath[i].y);
        }

        const firstP = interpolatedPoints[0];
        const firstW = interpolatedWidths[0];
        const firstNextP = interpolatedPoints[1];
        const startAngle = Math.atan2(firstNextP.y - firstP.y, firstNextP.x - firstP.x);
        ctx.arc(firstP.x, firstP.y, firstW / 2, startAngle + Math.PI / 2, startAngle - Math.PI / 2);

        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      }
      } catch (e) {
      }
    }}
  />
);

const FloatingToolbar = React.memo(({ 
  tool, setTool, pens, activePenId, setActivePenId, updateActivePen, activePen,
  stageScale, onZoomChange, onResetZoom,
  isFullScreen, toggleFullScreen,
  hasMask, handleCropTool,
  onFileChange, onOpenPageSelector,
  currPage, numPages, onPrevPage, onNextPage, onClearAll, 
  onUndo, onRedo, canUndo, canRedo,
  showPenSettings, setShowPenSettings, showZoomSlider, setShowZoomSlider,
  isMobile, loadPdf // loadPdf 함수 props로 받기
}) => {
  const [penSettingsPos, setPenSettingsPos] = useState({ top: 0, left: 0 });
  const [loadMenuPos, setLoadMenuPos] = useState({ top: 0, left: 0 });
  const [sliderPos, setSliderPos] = useState({ top: 0, left: 0 });
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [driveFiles, setDriveFiles] = useState([]);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);

  const toolbarRef = useRef(null);
  const fileInputRef = useRef(null);
  const loadBtnRef = useRef(null);
  const zoomControlRef = useRef(null);
  const sliderRef = useRef(null);
  const penBtnRefs = useRef([]);
  const penSettingsRef = useRef(null);

  const stopPropagation = (e) => e.stopPropagation();

  useEffect(() => {
    if (showZoomSlider && zoomControlRef.current) {
      const rect = zoomControlRef.current.getBoundingClientRect();
      setSliderPos({ top: rect.top - 60, left: rect.left + rect.width / 2 - 70 });
    }
  }, [showZoomSlider]);

  useEffect(() => {
    const activeBtnRef = penBtnRefs.current[activePenId];
    if (showPenSettings && activeBtnRef) {
      const rect = activeBtnRef.getBoundingClientRect();
      setPenSettingsPos({ top: rect.top - 160, left: rect.left + rect.width / 2 - 110 });
    }
  }, [showPenSettings, activePenId]);

  useEffect(() => {
    if (showLoadMenu && loadBtnRef.current) {
      const rect = loadBtnRef.current.getBoundingClientRect();
      setLoadMenuPos({ top: rect.top - 90, left: rect.left });
    }
  }, [showLoadMenu]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showZoomSlider && zoomControlRef.current && !zoomControlRef.current.contains(event.target) && sliderRef.current && !sliderRef.current.contains(event.target)) {
        setShowZoomSlider(false);
      }
      const activeBtnRef = penBtnRefs.current[activePenId];
      if (showPenSettings && activeBtnRef && !activeBtnRef.contains(event.target) && 
          penSettingsRef.current && !penSettingsRef.current.contains(event.target) &&
          !penBtnRefs.current.some(ref => ref && ref.contains(event.target))) {
        setShowPenSettings(false);
      }
      if (showLoadMenu && loadBtnRef.current && !loadBtnRef.current.contains(event.target)) {
        setShowLoadMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showZoomSlider, showPenSettings, activePenId, showLoadMenu]);

  // 구글 드라이브 파일 목록 가져오기
  const fetchDriveFiles = async () => {
    if (!GOOGLE_API_KEY || !GOOGLE_FOLDER_ID) {
      alert("구글 API 키와 폴더 ID를 코드에 설정해주세요.");
      return;
    }
    setIsLoadingDrive(true);
    try {
      const q = `'${GOOGLE_FOLDER_ID}' in parents and trashed=false`;
      const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&key=${GOOGLE_API_KEY}`);
      const data = await response.json();
      
      if (data.error) throw new Error(data.error.message);
      
      setDriveFiles(data.files || []);
      setShowDriveModal(true);
    } catch (e) {
      console.error(e);
      alert("구글 드라이브 연결 오류: " + e.message);
    } finally {
      setIsLoadingDrive(false);
      setShowLoadMenu(false);
    }
  };

  // [추가] 파일 더블클릭 시 PDF 다운로드 및 로드 처리
  const handleFileDoubleClick = async (fileId) => {
    setIsLoadingDrive(true);
    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${GOOGLE_API_KEY}`);
      if (!response.ok) {
        throw new Error("파일 다운로드 실패. 파일이 공개 상태인지 확인하세요.");
      }
      const blob = await response.blob();
      loadPdf(blob); // 훅의 loadPdf 호출하여 파일 로드
      setShowDriveModal(false); // 로드 완료 후 모달 닫기
    } catch (error) {
      console.error(error);
      alert("파일을 불러오는 데 실패했습니다: " + error.message);
    } finally {
      setIsLoadingDrive(false);
    }
  };

  const currentBtnStyle = isMobile ? { ...btnStyle, padding: '6px' } : btnStyle;
  const currentActiveBtn = isMobile ? { ...activeBtn, padding: '6px' } : activeBtn;
  const currentDisabledBtn = isMobile ? { ...disabledBtnStyle, padding: '6px' } : disabledBtnStyle;
  const iconSize = isMobile ? 18 : 20;

  return (
    <div 
      ref={toolbarRef}
      style={{
        position: 'fixed', bottom: isMobile ? '10px' : '20px', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'row', flexWrap: 'wrap', maxWidth: '94vw', maxHeight: '90vh',
        justifyContent: 'center', alignItems: 'center', gap: isMobile ? '4px' : '8px', padding: isMobile ? '6px' : '10px',
        background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(10px)',
        borderRadius: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', zIndex: 1000,
        transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', gap: isMobile ? '4px' : '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button ref={loadBtnRef} onClick={() => setShowLoadMenu(!showLoadMenu)} style={currentBtnStyle} title="불러오기"><FileUp size={iconSize}/></button>
        
        {showLoadMenu && createPortal(
          <div 
            onMouseDown={stopPropagation} onTouchStart={stopPropagation}
            style={{
              position: 'fixed', top: loadMenuPos.top, left: loadMenuPos.left,
              background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(10px)',
              padding: '8px', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '150px'
          }}>
            <button onClick={() => { fileInputRef.current.click(); setShowLoadMenu(false); }} style={{...btnStyle, justifyContent: 'flex-start', width: '100%'}}>
               <FileUp size={16} style={{marginRight: 8}}/> 내 컴퓨터
            </button>
            <button onClick={fetchDriveFiles} style={{...btnStyle, justifyContent: 'flex-start', width: '100%'}}>
               <Folder size={16} style={{marginRight: 8}}/> {isLoadingDrive ? '로딩 중...' : '구글 폴더'}
            </button>
          </div>, document.body
        )}

        <input type="file" ref={fileInputRef} onChange={onFileChange} accept="application/pdf" hidden />
        <button onClick={onOpenPageSelector} style={currentBtnStyle} title="페이지 목록"><LayoutGrid size={iconSize}/></button>
        <button onClick={onUndo} disabled={!canUndo} style={!canUndo ? currentDisabledBtn : currentBtnStyle} title="실행 취소"><Undo size={iconSize}/></button>
        <button onClick={onRedo} disabled={!canRedo} style={!canRedo ? currentDisabledBtn : currentBtnStyle} title="다시 실행"><Redo size={iconSize}/></button>
        <div style={{ ...dividerHorizontal, margin: isMobile ? '0 4px' : '0 8px' }} />
        <button onClick={() => setTool('hand')} style={tool === 'hand' ? currentActiveBtn : currentBtnStyle}><Hand size={iconSize}/></button>
        
        {pens.map((pen, index) => (
          <div key={index} style={{ position: 'relative' }}>
            <button 
              ref={el => penBtnRefs.current[index] = el}
              onClick={() => {
                if (tool === 'pen' && activePenId === index) {
                  setShowPenSettings(!showPenSettings);
                } else {
                  setTool('pen'); setActivePenId(index); setShowPenSettings(false); 
                }
              }} 
              style={(tool === 'pen' && activePenId === index) ? currentActiveBtn : currentBtnStyle}
              title={`펜 ${index + 1} (클릭하여 설정)`}
            >
              {pen.type === 'highlighter' ? <Highlighter size={iconSize}/> : pen.type === 'pressure' ? <PenTool size={iconSize}/> : pen.type === 'smart' ? <Sparkles size={iconSize}/> : <Pencil size={iconSize}/>}
              <div style={{ position: 'absolute', bottom: 4, right: 4, width: 6, height: 6, borderRadius: '50%', backgroundColor: pen.color, border: '1px solid rgba(0,0,0,0.1)' }}/>
            </button>
          </div>
        ))}

        <div style={{ position: 'relative' }}>
          {showPenSettings && createPortal(
            <div ref={penSettingsRef} 
              onMouseDown={stopPropagation} onTouchStart={stopPropagation}
              onMouseMove={stopPropagation} onTouchMove={stopPropagation}
              style={{
                position: 'fixed', top: penSettingsPos.top, left: penSettingsPos.left,
                background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(10px)',
                padding: '12px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '220px'
            }}>
              <div style={{ display: 'flex', gap: '5px', justifyContent: 'space-between' }}>
                <button onClick={() => updateActivePen({ type: 'basic', width: 3 })} style={activePen.type === 'basic' ? activeBtn : btnStyle} title="일반 펜"><Pencil size={18}/></button>
                <button onClick={() => updateActivePen({ type: 'pressure', width: 3 })} style={activePen.type === 'pressure' ? activeBtn : btnStyle} title="필압 펜"><PenTool size={18}/></button>
                <button onClick={() => updateActivePen({ type: 'highlighter', width: 20 })} style={activePen.type === 'highlighter' ? activeBtn : btnStyle} title="형광펜"><Highlighter size={18}/></button>
                <button onClick={() => updateActivePen({ type: 'smart', width: 3 })} style={activePen.type === 'smart' ? activeBtn : btnStyle} title="스마트 펜 (도형 보정)"><Sparkles size={18}/></button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#666', whiteSpace: 'nowrap' }}>두께: {activePen.width}</span>
                <input type="range" min="1" max="50" value={activePen.width} onChange={(e) => updateActivePen({ width: parseInt(e.target.value) })} style={{ width: '100%', accentColor: '#6366f1' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
                {colorPalette.map(c => (
                  <div key={c} onClick={() => updateActivePen({ color: c })} 
                    style={{ width: '24px', height: '24px', borderRadius: '50%', background: c, border: activePen.color === c ? '2px solid #6366f1' : '1px solid #ddd', cursor: 'pointer', transform: activePen.color === c ? 'scale(1.1)' : 'none', transition: 'transform 0.2s' }} 
                  />
                ))}
              </div>
            </div>, document.body
          )}
        </div>

        <button onClick={() => setTool('eraser')} style={tool === 'eraser' ? currentActiveBtn : currentBtnStyle}><Eraser size={iconSize}/></button>
        
        <button onClick={onClearAll} style={currentBtnStyle} title="전체 삭제"><Trash2 size={iconSize}/></button>

        <button onClick={handleCropTool} style={(tool === 'crop' || hasMask) ? currentActiveBtn : currentBtnStyle} title={hasMask ? "마스킹 해제" : "영역 잘라내기"}><Crop size={iconSize}/></button>
      </div>
      
      <div style={{ ...dividerHorizontal, margin: isMobile ? '0 4px' : '0 8px' }} />

      <div ref={zoomControlRef} style={{ display: 'flex', flexDirection: 'row', gap: '12px', alignItems: 'center', position: 'relative' }}>
        <span onClick={() => setShowZoomSlider(!showZoomSlider)} style={{ fontSize: '13px', color: '#666', fontWeight: 'bold', cursor: 'pointer', userSelect: 'none' }}>
          {Math.round(stageScale * 100)}%
        </span>

        {showZoomSlider && createPortal(
          <div ref={sliderRef} 
            onMouseDown={stopPropagation} onTouchStart={stopPropagation}
            onMouseMove={stopPropagation} onTouchMove={stopPropagation}
            style={{
              touchAction: 'none', position: 'fixed', top: sliderPos.top, left: sliderPos.left,
              background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(10px)',
              padding: '8px 12px', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 9999, display: 'flex', alignItems: 'center', minWidth: '140px'
          }}>
            <input type="range" min="0.2" max="5" step="0.1" value={stageScale} onChange={(e) => onZoomChange(parseFloat(e.target.value))} style={{ width: '100%', cursor: 'pointer', accentColor: '#6366f1' }} />
          </div>, document.body
        )}

        <button onClick={onResetZoom} style={currentBtnStyle}><RotateCcw size={isMobile ? 16 : 18}/></button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '0 4px' }}>
          <button onClick={onPrevPage} disabled={currPage <= 1} style={currPage <= 1 ? currentDisabledBtn : currentBtnStyle}><ChevronLeft size={isMobile ? 16 : 18}/></button>
          <span style={{ fontSize: '12px', color: '#555', minWidth: '40px', textAlign: 'center', userSelect: 'none' }}>{currPage} / {numPages || '-'}</span>
          <button onClick={onNextPage} disabled={!numPages || currPage >= numPages} style={(!numPages || currPage >= numPages) ? currentDisabledBtn : currentBtnStyle}><ChevronRight size={isMobile ? 16 : 18}/></button>
        </div>
        <button onClick={toggleFullScreen} style={currentBtnStyle}>
          {isFullScreen ? <Minimize size={isMobile ? 16 : 18}/> : <Maximize size={isMobile ? 16 : 18}/>}
        </button>
      </div>

      {/* 구글 드라이브 파일 목록 모달 */}
      {showDriveModal && createPortal(
        <div style={modalOverlayStyle} onClick={() => setShowDriveModal(false)}>
          <div style={{ ...modalContentStyle, maxWidth: '500px', height: 'auto', maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0, color: '#333' }}>구글 공유폴더 파일</h3>
              <button onClick={() => setShowDriveModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}><X size={20}/></button>
            </div>
            {isLoadingDrive ? (
              <p style={{ textAlign: 'center', color: '#666', padding: '20px' }}>파일을 다운로드 중입니다...</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
                {driveFiles.length === 0 ? <p style={{ color: '#666', textAlign: 'center' }}>파일이 없습니다.</p> : driveFiles.map(file => (
                  <div 
                    key={file.id} 
                    style={driveFileItemStyle}
                    // [추가] 더블클릭 이벤트 연결
                    onDoubleClick={() => handleFileDoubleClick(file.id)}
                    title="더블클릭하여 파일 열기"
                  >
                    {file.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>, document.body
      )}
    </div>
  );
});

const SmartBoardApp = () => {
  const board = useSmartBoard();

  const [showPenSettings, setShowPenSettings] = useState(false);
  const [showZoomSlider, setShowZoomSlider] = useState(false);

  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = dimensions.width < 768; 

  const handleStageMouseDown = (e) => {
    setShowPenSettings(false);
    setShowZoomSlider(false);
    board.handleMouseDown(e);
  };

  const handleStageTouchStart = (e) => {
    setShowPenSettings(false);
    setShowZoomSlider(false);
    board.handleTouchStart(e);
  };

  const boardContent = useMemo(() => (
    <>
      <div style={{ display: 'none' }}>
        {board.pdfFile && (
          <Document file={board.pdfFile} onLoadSuccess={board.onDocumentLoadSuccess}>
            <Page pageNumber={board.currPage} onRenderSuccess={board.onRenderSuccess} width={dimensions.width} renderTextLayer={false} renderAnnotationLayer={false} />
          </Document>
        )}
      </div>

      <div style={{ width: '100%', height: '100%', cursor: board.tool === 'hand' ? 'grab' : 'crosshair' }}>
        <Stage
          width={dimensions.width} height={dimensions.height}
          scaleX={board.stageScale} scaleY={board.stageScale}
          x={board.stagePos.x} y={board.stagePos.y}
          onMouseDown={handleStageMouseDown} onMouseMove={board.handleMouseMove} onMouseUp={board.handleMouseUp}
          onTouchStart={handleStageTouchStart} onTouchMove={board.handleTouchMove} onTouchEnd={board.handleTouchEnd}
          onWheel={board.handleWheel}
          draggable={board.tool === 'hand'}
          onDragEnd={(e) => board.setStagePos({ x: e.target.x(), y: e.target.y() })}
          ref={board.stageRef}
        >
          <Layer>
            <Rect width={dimensions.width * 20} height={dimensions.height * 20} x={-dimensions.width * 10} y={-dimensions.height * 10} fill={board.bgColor} />
            {board.pdfImage && (
              <Image image={board.pdfImage} x={0} y={0} width={dimensions.width} height={(dimensions.width * board.pdfImage.height) / board.pdfImage.width} shadowBlur={5} shadowColor="rgba(0,0,0,0.1)" />
            )}
          </Layer>

          <Layer>
            {board.lines.map((line, i) => line.tool === 'rect' ? (
              <Rect key={i} x={line.x} y={line.y} width={line.width} height={line.height} fill={line.fill} />
            ) : null)}
          </Layer>

          <Layer>
            {board.lines.map((line, i) => line.tool === 'ellipse' ? (
              <React.Fragment key={i}>
                <Ellipse x={line.x + line.width/2} y={line.y + line.height/2} radiusX={Math.abs(line.width)/2} radiusY={Math.abs(line.height)/2} stroke={line.color} strokeWidth={line.strokeWidth} fillEnabled={false} />
              </React.Fragment>
            ) : null)}

            {board.lines.map((line, i) => line.tool === 'smart_path' ? (
              <Path
                key={i}
                data={line.pathData}
                stroke={line.color}
                strokeWidth={line.strokeWidth}
                lineCap="round"
                lineJoin="round"
                opacity={line.opacity || 1}
                globalCompositeOperation={line.color === 'white' ? 'destination-out' : 'source-over'}
              />
            ) : null)}

            {board.lines.map((line, i) => line.penType === 'pressure' ? (
              <PressureLine key={i} points={line.points} widths={line.widths} color={line.color} />
            ) : null)}

            {board.lines.map((line, i) => {
              if (line.tool !== 'rect' && line.tool !== 'ellipse' && line.tool !== 'smart_path' && line.penType !== 'pressure') {
                return (
                  <Line
                    key={i} points={line.points} stroke={line.color} strokeWidth={line.strokeWidth}
                    tension={line.tension !== undefined ? line.tension : (line.penType === 'highlighter' ? 0 : 0.4)} 
                    lineCap="round" lineJoin="round"
                    opacity={line.opacity || 1}
                    globalCompositeOperation={line.color === 'white' ? 'destination-out' : 'source-over'}
                  />
                );
              }
              return null;
            })}
            {board.currentCrop && (
              <Rect x={board.currentCrop.x} y={board.currentCrop.y} width={board.currentCrop.width} height={board.currentCrop.height} stroke="red" strokeWidth={2} dash={[5, 5]} />
            )}
          </Layer>
        </Stage>
      </div>
    </>
  ), [
    board.pdfFile, board.pdfImage, board.lines, board.tool, board.stageScale, board.stagePos, board.bgColor, 
    board.currentCrop, board.onRenderSuccess, board.handleMouseDown, board.handleMouseMove, board.handleMouseUp, 
    board.handleTouchStart, board.handleTouchMove, board.handleTouchEnd, board.handleWheel, board.currPage, board.onDocumentLoadSuccess, dimensions,
  ]);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#222', overflow: 'hidden' }}>
      
      <FloatingToolbar 
        tool={board.tool} setTool={board.setTool} pens={board.pens} activePenId={board.activePenId} setActivePenId={board.setActivePenId}
        updateActivePen={board.updateActivePen} activePen={board.activePen}
        stageScale={board.stageScale} onZoomChange={board.handleZoomChange} onResetZoom={board.handleResetZoom}
        isFullScreen={board.isFullScreen} toggleFullScreen={board.toggleFullScreen}
        hasMask={board.hasMask} handleCropTool={board.handleCropTool} onFileChange={board.handleFileChange}
        onOpenPageSelector={() => board.setShowPageSelector(true)}
        currPage={board.currPage} numPages={board.numPages} onPrevPage={board.handlePrevPage} onNextPage={board.handleNextPage}
        onClearAll={board.handleClearAll}
        onUndo={board.undo} onRedo={board.redo} canUndo={board.canUndo} canRedo={board.canRedo}
        showPenSettings={showPenSettings} setShowPenSettings={setShowPenSettings}
        showZoomSlider={showZoomSlider} setShowZoomSlider={setShowZoomSlider}
        isMobile={isMobile}
        loadPdf={board.loadPdf} // [추가] 훅에서 받아온 함수 전달
      />

      {board.showPageSelector && board.pdfFile && (
        <div style={modalOverlayStyle} onClick={() => board.setShowPageSelector(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 20px 0', color: '#333' }}>페이지 선택</h3>
            <Document file={board.pdfFile}>
              <div style={gridStyle}>
                {Array.from(new Array(board.numPages), (el, index) => (
                  <div key={`page_${index + 1}`} onClick={() => board.changePage(index + 1)} 
                    style={{ ...thumbnailStyle, border: board.currPage === index + 1 ? '2px solid #6366f1' : '1px solid #eee', backgroundColor: board.currPage === index + 1 ? '#eef2ff' : 'white' }}>
                    <div style={{ pointerEvents: 'none' }}>
                      <Page pageNumber={index + 1} width={75} renderTextLayer={false} renderAnnotationLayer={false} />
                    </div>
                    <span style={{ marginTop: '8px', fontSize: '14px', fontWeight: '500', color: '#555' }}>{index + 1}</span>
                  </div>
                ))}
              </div>
            </Document>
          </div>
        </div>
      )}

      {boardContent}
    </div>
  );
};

const btnStyle = { padding: '8px', border: '1px solid #e5e7eb', background: '#fff', color: '#374151', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', transition: 'all 0.2s' };
const activeBtn = { ...btnStyle, background: '#eef2ff', border: '1px solid #6366f1', color: '#6366f1' };
const disabledBtnStyle = { ...btnStyle, opacity: 0.5, cursor: 'not-allowed', background: '#f3f4f6' };
const dividerHorizontal = { width: '1px', height: '20px', background: '#eee', margin: '0 8px' };
const modalOverlayStyle = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(5px)' };
const modalContentStyle = { width: '80%', height: '80%', backgroundColor: 'white', borderRadius: '16px', padding: '24px', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '10px', padding: '10px', width: '100%' };
const thumbnailStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', padding: '10px', borderRadius: '12px', transition: 'all 0.2s', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' };
const driveFileItemStyle = { padding: '12px', border: '1px solid #eee', borderRadius: '8px', background: '#f9fafb', color: '#333', cursor: 'pointer', textAlign: 'left', fontSize: '14px', transition: 'background 0.2s', userSelect: 'none' };

export default SmartBoardApp;