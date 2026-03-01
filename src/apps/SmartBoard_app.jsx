// SmartBoard_app.jsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Stage, Layer, Image, Rect, Line, Ellipse, Path } from 'react-konva';
import { Document, Page, pdfjs } from 'react-pdf';
import { FileUp, Hand, Pencil, Eraser, RotateCcw, Crop, Maximize, Minimize, Highlighter, PenTool, LayoutGrid, ChevronLeft, ChevronRight, Trash2, Undo, Redo, Sparkles } from 'lucide-react';
import { useSmartBoard, colorPalette } from './SmartBoard_hooks'; // 만들어둔 훅 임포트

// 최신 라이브러리 환경에 맞는 워커 설정
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// --- [UI 전용 컴포넌트] 플로팅 툴바 ---
const FloatingToolbar = React.memo(({ 
  tool, setTool, pens, activePenId, setActivePenId, updateActivePen, activePen,
  stageScale, onZoomChange, onResetZoom,
  isFullScreen, toggleFullScreen,
  hasMask, handleCropTool,
  onFileChange, onOpenPageSelector,
  currPage, numPages, onPrevPage, onNextPage, onClearAll,
  onUndo, onRedo, canUndo, canRedo
}) => {
  // 툴바 내부의 UI 상태 (팝업 열림/닫힘 등)는 툴바 스스로 관리합니다.
  const [showPenSettings, setShowPenSettings] = useState(false);
  const [penSettingsPos, setPenSettingsPos] = useState({ top: 0, left: 0 });
  const [showZoomSlider, setShowZoomSlider] = useState(false);
  const [sliderPos, setSliderPos] = useState({ top: 0, left: 0 });
  const [showClearConfirm, setShowClearConfirm] = useState(false); // 삭제 확인 팝업 상태

  const toolbarRef = useRef(null);
  const fileInputRef = useRef(null);
  const zoomControlRef = useRef(null);
  const sliderRef = useRef(null);
  const penBtnRefs = useRef([]);
  const penSettingsRef = useRef(null);
  const clearConfirmRef = useRef(null); // 삭제 팝업 참조

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
      if (showClearConfirm && clearConfirmRef.current && !clearConfirmRef.current.contains(event.target)) {
        setShowClearConfirm(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showZoomSlider, showPenSettings, activePenId, showClearConfirm]);

  return (
    <div 
      ref={toolbarRef}
      style={{
        position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'row', flexWrap: 'wrap', maxWidth: '94vw', maxHeight: '90vh',
        justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '10px',
        background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(10px)',
        borderRadius: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', zIndex: 1000,
        transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={() => fileInputRef.current.click()} style={btnStyle} title="PDF 불러오기"><FileUp size={20}/></button>
        <input type="file" ref={fileInputRef} onChange={onFileChange} accept="application/pdf" hidden />
        <button onClick={onOpenPageSelector} style={btnStyle} title="페이지 목록"><LayoutGrid size={20}/></button>
        <button onClick={onUndo} disabled={!canUndo} style={!canUndo ? disabledBtnStyle : btnStyle} title="실행 취소"><Undo size={20}/></button>
        <button onClick={onRedo} disabled={!canRedo} style={!canRedo ? disabledBtnStyle : btnStyle} title="다시 실행"><Redo size={20}/></button>
        <div style={dividerHorizontal} />
        <button onClick={() => setTool('hand')} style={tool === 'hand' ? activeBtn : btnStyle}><Hand size={20}/></button>
        
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
              style={(tool === 'pen' && activePenId === index) ? activeBtn : btnStyle}
              title={`펜 ${index + 1} (클릭하여 설정)`}
            >
              {pen.type === 'highlighter' ? <Highlighter size={20}/> : pen.type === 'pressure' ? <PenTool size={20}/> : pen.type === 'smart' ? <Sparkles size={20}/> : <Pencil size={20}/>}
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

        <button onClick={() => setTool('eraser')} style={tool === 'eraser' ? activeBtn : btnStyle}><Eraser size={20}/></button>
        
        {/* 전체 삭제 버튼 및 팝업 */}
        <div style={{ position: 'relative' }} ref={clearConfirmRef}>
          {showClearConfirm && (
            <div style={{
              position: 'absolute', bottom: '120%', left: '50%', transform: 'translateX(-50%)',
              marginBottom: '8px', background: 'white', padding: '12px', borderRadius: '8px',
              boxShadow: '0 4px 15px rgba(0,0,0,0.15)', zIndex: 20, minWidth: '180px', textAlign: 'center',
              border: '1px solid #eee'
            }}>
              <div style={{ marginBottom: '10px', fontSize: '13px', fontWeight: '600', color: '#333' }}>모두 지우시겠습니까?</div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                <button onClick={() => { onClearAll(); setShowClearConfirm(false); }} style={{ padding: '6px 12px', borderRadius: '4px', background: '#ef4444', color: 'white', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>예</button>
                <button onClick={() => setShowClearConfirm(false)} style={{ padding: '6px 12px', borderRadius: '4px', background: '#f3f4f6', color: '#374151', border: 'none', cursor: 'pointer', fontSize: '12px' }}>아니오</button>
              </div>
              {/* 말풍선 화살표 */}
              <div style={{ 
                position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', 
                borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '6px solid white' 
              }} />
            </div>
          )}
          <button onClick={() => setShowClearConfirm(!showClearConfirm)} style={btnStyle} title="전체 삭제"><Trash2 size={20}/></button>
        </div>

        <button onClick={handleCropTool} style={(tool === 'crop' || hasMask) ? activeBtn : btnStyle} title={hasMask ? "마스킹 해제" : "영역 잘라내기"}><Crop size={20}/></button>
      </div>
      
      <div style={dividerHorizontal} />

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

        <button onClick={onResetZoom} style={btnStyle}><RotateCcw size={18}/></button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '0 4px' }}>
          <button onClick={onPrevPage} disabled={currPage <= 1} style={currPage <= 1 ? disabledBtnStyle : btnStyle}><ChevronLeft size={18}/></button>
          <span style={{ fontSize: '12px', color: '#555', minWidth: '40px', textAlign: 'center', userSelect: 'none' }}>{currPage} / {numPages || '-'}</span>
          <button onClick={onNextPage} disabled={!numPages || currPage >= numPages} style={(!numPages || currPage >= numPages) ? disabledBtnStyle : btnStyle}><ChevronRight size={18}/></button>
        </div>
        <button onClick={toggleFullScreen} style={btnStyle}>
          {isFullScreen ? <Minimize size={18}/> : <Maximize size={18}/>}
        </button>
      </div>
    </div>
  );
});

// --- [메인 앱 (컨트롤 타워)] ---
const SmartBoardApp = () => {
  // 1. 훅에서 모든 로직과 상태를 가져옵니다.
  const board = useSmartBoard();

  // 2. 메인 캔버스 렌더링 최적화
  const boardContent = useMemo(() => (
    <>
      <div style={{ display: 'none' }}>
        {board.pdfFile && (
          <Document file={board.pdfFile} onLoadSuccess={board.onDocumentLoadSuccess}>
            <Page pageNumber={board.currPage} onRenderSuccess={board.onRenderSuccess} width={window.innerWidth} renderTextLayer={false} renderAnnotationLayer={false} />
          </Document>
        )}
      </div>

      <div style={{ width: '100%', height: '100%', cursor: board.tool === 'hand' ? 'grab' : 'crosshair' }}>
        <Stage
          width={window.innerWidth} height={window.innerHeight}
          scaleX={board.stageScale} scaleY={board.stageScale}
          x={board.stagePos.x} y={board.stagePos.y}
          onMouseDown={board.handleMouseDown} onMouseMove={board.handleMouseMove} onMouseUp={board.handleMouseUp}
          onTouchStart={board.handleTouchStart} onTouchMove={board.handleTouchMove} onTouchEnd={board.handleTouchEnd}
          onWheel={board.handleWheel}
          draggable={board.tool === 'hand'}
          onDragEnd={(e) => board.setStagePos({ x: e.target.x(), y: e.target.y() })}
          ref={board.stageRef}
        >
          {/* 배경 및 PDF 레이어 */}
          <Layer>
            <Rect width={window.innerWidth * 20} height={window.innerHeight * 20} x={-window.innerWidth * 10} y={-window.innerHeight * 10} fill={board.bgColor} />
            {board.pdfImage && (
              <Image image={board.pdfImage} x={0} y={0} width={window.innerWidth} height={(window.innerWidth * board.pdfImage.height) / board.pdfImage.width} shadowBlur={5} shadowColor="rgba(0,0,0,0.1)" />
            )}
          </Layer>

          {/* 마스킹 레이어 */}
          <Layer>
            {board.lines.map((line, i) => line.tool === 'rect' ? (
              <Rect key={i} x={line.x} y={line.y} width={line.width} height={line.height} fill={line.fill} />
            ) : null)}
          </Layer>

          {/* 판서 레이어 */}
          <Layer>
            {/* 타원/원 렌더링 */}
            {board.lines.map((line, i) => line.tool === 'ellipse' ? (
              <React.Fragment key={i}>
                {/* 타원 */}
                <Ellipse x={line.x + line.width/2} y={line.y + line.height/2} radiusX={Math.abs(line.width)/2} radiusY={Math.abs(line.height)/2} stroke={line.color} strokeWidth={line.strokeWidth} fillEnabled={false} />
              </React.Fragment>
            ) : null)}

            {/* 스마트 곡선 (Path) 렌더링 */}
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

            {/* 선/곡선 렌더링 */}
            {board.lines.map((line, i) => {
              if (line.tool !== 'rect' && line.tool !== 'ellipse' && line.tool !== 'smart_path') {
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
    board.handleTouchStart, board.handleTouchMove, board.handleTouchEnd, board.handleWheel, board.currPage, board.onDocumentLoadSuccess
  ]);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#222', overflow: 'hidden' }}>
      
      {/* 플로팅 툴바에 필요한 데이터와 함수만 넘겨줌 */}
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
      />

      {/* 페이지 선택 모달 */}
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
                      <Page pageNumber={index + 1} width={150} renderTextLayer={false} renderAnnotationLayer={false} />
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

// --- 스타일링 속성 ---
const btnStyle = { padding: '8px', border: '1px solid #e5e7eb', background: '#fff', color: '#374151', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', transition: 'all 0.2s' };
const activeBtn = { ...btnStyle, background: '#eef2ff', border: '1px solid #6366f1', color: '#6366f1' };
const disabledBtnStyle = { ...btnStyle, opacity: 0.5, cursor: 'not-allowed', background: '#f3f4f6' };
const dividerHorizontal = { width: '1px', height: '20px', background: '#eee', margin: '0 8px' };
const modalOverlayStyle = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(5px)' };
const modalContentStyle = { width: '80%', height: '80%', backgroundColor: 'white', borderRadius: '16px', padding: '24px', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '20px', padding: '10px', width: '100%' };
const thumbnailStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', padding: '10px', borderRadius: '12px', transition: 'all 0.2s', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' };

export default SmartBoardApp;