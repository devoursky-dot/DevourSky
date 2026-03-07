import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { getStroke } from 'perfect-freehand';
import { QRCodeCanvas } from 'qrcode.react';
import { Pencil, Eraser, Trash2, Share2, MessageSquare, Undo, Redo, Maximize, Minimize } from 'lucide-react';

import { db } from './PenQR_conf';
import { doc, setDoc, collection, onSnapshot, query, orderBy, deleteDoc, getDocs } from 'firebase/firestore';

// 스플라인 경로 생성 함수
const getSvgPathFromStroke = (stroke) => {
  if (!stroke.length) return "";
  const d = stroke.reduce((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length];
    acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    return acc;
  }, ["M", ...stroke[0], "Q"]);
  d.push("Z");
  return d.join(" ");
};

const colorPalette = [
  '#000000', '#333333', '#666666', '#999999', '#FFFFFF',
  '#FF0000', '#FFA500', '#FFFF00', '#008000', '#0000FF',
  '#4B0082', '#800080', '#FFC0CB', '#A52A2A', '#00FFFF',
  '#008080', '#000080', '#808000', '#800000', '#FF00FF'
];

const PenQR = () => {
  const [history, setHistory] = useState([[]]); // 전체 히스토리 저장
  const [currentStep, setCurrentStep] = useState(0); // 현재 히스토리 단계
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [dpr, setDpr] = useState(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const strokes = history[currentStep]; // 현재 보여줄 스트로크
  const strokesRef = useRef([]); // 그리기 데이터의 즉각적인 참조를 위한 Ref
  const [tool, setTool] = useState('pen');
  const [penColor, setPenColor] = useState('#000000');
  const [penWidth, setPenWidth] = useState(5);
  const [showPenSettings, setShowPenSettings] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [responses, setResponses] = useState([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [boardImage, setBoardImage] = useState(null); // 캡처된 판서 이미지 저장
  const staticCanvasRef = useRef(null); // 완료된 획 (배경)
  const activeCanvasRef = useRef(null); // 현재 긋는 획 (전경)
  const isDrawing = useRef(false);
  const currentPoints = useRef([]);
  const [roomId] = useState(() => Math.random().toString(36).substring(2, 8).toUpperCase()); // 랜덤 룸 ID 생성
  const [isDrawingNow, setIsDrawingNow] = useState(false); // [최적화] 드로잉 중 UI 숨김 상태

  const isMobile = windowSize.width < 768; // [추가] 모바일 감지
  const btnStyle = isMobile ? { ...styles.btn, padding: 6 } : styles.btn;
  const activeBtnStyle = isMobile ? { ...styles.activeBtn, padding: 6 } : styles.activeBtn;
  const disabledBtnStyle = isMobile ? { ...styles.disabledBtn, padding: 6 } : styles.disabledBtn;
  const shareBtnStyle = isMobile ? { ...styles.shareBtn, padding: '8px 12px', fontSize: 13 } : styles.shareBtn;
  const iconSize = isMobile ? 18 : 24;

  // [수정] 16:9 질문 영역 좌표 및 스타일 계산
  const frameRect = useMemo(() => {
    const { width, height } = windowSize;
    const targetRatio = 16 / 9;
    
    let frameW, frameH;
    // 화면 여백을 고려하여 최대 크기 계산 (여백 40px)
    const padding = 40;
    const availW = width - padding;
    const availH = height - padding;

    if (availW <= 0 || availH <= 0) return { x: 0, y: 0, width: 0, height: 0 };

    if (availW / availH > targetRatio) {
      // 화면이 더 와이드함 -> 높이 기준
      frameH = availH;
      frameW = frameH * targetRatio;
    } else {
      // 화면이 더 좁음 -> 너비 기준
      frameW = availW;
      frameH = frameW / targetRatio;
    }

    return {
      x: (width - frameW) / 2,
      y: (height - frameH) / 2,
      width: frameW,
      height: frameH
    };
  }, [windowSize]);

  const frameStyle = useMemo(() => ({
      position: 'absolute',
      width: frameRect.width,
      height: frameRect.height,
      top: frameRect.y,
      left: frameRect.x,
      border: '2px dashed rgba(0, 0, 0, 0.2)',
      borderRadius: '8px',
      // 영역 밖을 살짝 어둡게 처리하여 집중도 향상
      boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.05)',
      pointerEvents: 'none', // 판서 방해 금지
      zIndex: 5
  }), [frameRect]);

  // [추가] 앱 실행 시 전체 화면 모드 전환 시도 및 리사이즈/DPR 감지
  useEffect(() => {
    const enterFullScreen = async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        }
      } catch (e) {
        console.log("전체 화면 전환 실패 (사용자 상호작용 필요):", e);
      }
    };
    enterFullScreen();

    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
      setDpr(window.devicePixelRatio || 1);
    };
    const handleFullScreenChange = () => setIsFullScreen(!!document.fullscreenElement);

    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('fullscreenchange', handleFullScreenChange);
    };
  }, []);

  // 화면 크기나 DPR 변경 시 다시 그리기
  useEffect(() => {
    redrawAll();
  }, [windowSize, dpr]);

  // 1. 학생 답변 실시간 수신
  useEffect(() => {
    const q = query(collection(db, "rooms", roomId, "answers"), orderBy("timestamp", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setResponses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [roomId]);

  // strokes 상태가 변경되면 ref도 동기화 (Undo/Redo 등 외부 변경 대응)
  useEffect(() => {
    strokesRef.current = strokes;
    redrawAll();
  }, [strokes]);

  // 2. 판서 데이터 Firebase 업로드 (공유 버튼 클릭 시)
  const shareBoard = async () => {
    // [수정] 프레임 영역만 잘라서 이미지 저장
    if (staticCanvasRef.current) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = frameRect.width * dpr;
      tempCanvas.height = frameRect.height * dpr;
      const tCtx = tempCanvas.getContext('2d');
      
      tCtx.drawImage(
        staticCanvasRef.current, 
        frameRect.x * dpr, frameRect.y * dpr, frameRect.width * dpr, frameRect.height * dpr,
        0, 0, tempCanvas.width, tempCanvas.height
      );
      setBoardImage(tempCanvas.toDataURL());
    }

    await setDoc(doc(db, "rooms", roomId), {
      strokes: JSON.stringify(strokes),
      width: frameRect.width,
      height: frameRect.height,
      updatedAt: new Date()
    });
    setShowQR(true);
  };

  const handleCloseSession = () => {
    setShowConfirmModal(true);
  };

  const confirmCloseSession = async () => {
    setShowConfirmModal(false);
    setShowQR(false);
    try {
      const q = query(collection(db, "rooms", roomId, "answers"));
      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
      setResponses([]);
    } catch (e) {
      console.error("Error clearing answers:", e);
    }
  };

  // --- 드로잉 헬퍼 ---
  const drawStroke = (ctx, stroke) => {
    if (!stroke.points.length) return;
    
    // [수정] 프레임 영역 클리핑 적용
    ctx.save();
    ctx.beginPath();
    ctx.rect(frameRect.x, frameRect.y, frameRect.width, frameRect.height);
    ctx.clip();

    const size = stroke.tool === 'eraser' ? 25 : (stroke.width || 5);
    const color = stroke.tool === 'eraser' ? '#fff' : (stroke.color || '#000');
    const outline = getStroke(stroke.points, { size });
    const path = new Path2D(getSvgPathFromStroke(outline));
    ctx.fillStyle = color;
    ctx.fill(path);
    ctx.restore();
  };

  // 전체 다시 그리기 (Undo/Redo, Resize 시에만 호출)
  const redrawAll = useCallback(() => {
    if (!staticCanvasRef.current) return;
    const ctx = staticCanvasRef.current.getContext('2d');
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, staticCanvasRef.current.width, staticCanvasRef.current.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    strokesRef.current.forEach(s => drawStroke(ctx, s));
  }, [dpr, frameRect]);

  // 현재 긋고 있는 획만 그리기 (Active Canvas - 매우 빠름)
  const drawCurrent = useCallback(() => {
    if (!activeCanvasRef.current) return;
    const ctx = activeCanvasRef.current.getContext('2d');
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, activeCanvasRef.current.width, activeCanvasRef.current.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawStroke(ctx, {
      points: currentPoints.current,
      tool,
      color: penColor,
      width: penWidth
    });
  }, [tool, dpr, penColor, penWidth, frameRect]);

  const onPointerDown = (e) => {
    setIsDrawingNow(true); // [최적화] 드로잉 시작 시 UI 인터랙션 차단
    setShowPenSettings(false);
    isDrawing.current = true;
    e.target.setPointerCapture(e.pointerId); // 터치가 캔버스 밖으로 나가도 끊기지 않게 함
    currentPoints.current = [[e.clientX, e.clientY, e.pressure]];
    requestAnimationFrame(drawCurrent);
  };

  const onPointerMove = (e) => {
    if (!isDrawing.current) return;
    currentPoints.current.push([e.clientX, e.clientY, e.pressure]);
    requestAnimationFrame(drawCurrent);
  };

  const onPointerUp = () => {
    setIsDrawingNow(false); // [최적화] 드로잉 종료 시 UI 복구
    isDrawing.current = false;
    // [FIX] 상태 업데이트 전에 현재 포인트를 복사해야 함 (비동기 처리 시점 문제 해결)
    const newPoints = [...currentPoints.current];
    if (newPoints.length > 0) {
      const newStroke = { points: newPoints, tool, color: penColor, width: penWidth };
      const newStrokes = [...strokes, newStroke];
      strokesRef.current = newStrokes; // Ref 즉시 업데이트로 공백 제거

      // Static Canvas에 확정된 획 추가 (전체 다시 그리기 아님 -> 성능 최적화)
      const ctx = staticCanvasRef.current.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); 
      drawStroke(ctx, newStroke);
      
      const newHistory = history.slice(0, currentStep + 1);
      newHistory.push(newStrokes);
      setHistory(newHistory);
      setCurrentStep(newHistory.length - 1);
    }
    
    // Active Canvas 비우기
    currentPoints.current = [];
    drawCurrent(); 
  };

  // 실행 취소 (Undo)
  const handleUndo = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  // 다시 실행 (Redo)
  const handleRedo = () => {
    if (currentStep < history.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  // 전체 삭제
  const handleClear = () => {
    if (strokes.length === 0) return;
    const newHistory = history.slice(0, currentStep + 1);
    newHistory.push([]); // 빈 배열(삭제된 상태)을 히스토리에 추가
    setHistory(newHistory);
    setCurrentStep(newHistory.length - 1);
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(e => console.log(e));
    } else {
      document.exitFullscreen().catch(e => console.log(e));
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#eee' }}>
      {/* 배경 캔버스 (완료된 획) */}
      <canvas ref={staticCanvasRef} width={windowSize.width * dpr} height={windowSize.height * dpr} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: '#fff', touchAction: 'none' }} />
      {/* 전경 캔버스 (현재 그리기용) */}
      <canvas ref={activeCanvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} 
        width={windowSize.width * dpr} height={windowSize.height * dpr} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'transparent', touchAction: 'none' }} />
      
      {/* [추가] 16:9 가이드라인 표시 */}
      <div style={frameStyle} />

      {/* 툴바 */}
      <div style={{ 
        ...styles.toolbar, 
        bottom: isMobile ? 20 : 50, // [수정] 모바일 하단 여백 조정
        padding: isMobile ? '8px 12px' : '10px 20px', // [수정] 패딩 축소
        gap: isMobile ? 4 : 10, // [수정] 간격 축소
        maxWidth: '98vw', // [수정] 화면 너비 제한
        overflowX: 'auto', // [수정] 가로 스크롤 허용
        whiteSpace: 'nowrap', // [수정] 줄바꿈 방지
        scrollbarWidth: 'none', // [수정] 스크롤바 숨김
        opacity: isDrawingNow ? 0.1 : 1, // 드로잉 중 투명도 조절
        pointerEvents: isDrawingNow ? 'none' : 'auto', // 드로잉 중 이벤트 차단
        transition: 'opacity 0.2s'
      }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <button onClick={() => {
            if (tool === 'pen') {
              setShowPenSettings(!showPenSettings);
            } else {
              setTool('pen');
              setShowPenSettings(false);
            }
          }} style={tool === 'pen' ? activeBtnStyle : btnStyle}>
            <Pencil size={iconSize} color={tool === 'pen' ? penColor : '#000'} />
          </button>
          {showPenSettings && (
            <div style={styles.penSettingsPopup}>
              <div style={{marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5}}>
                <span style={{fontSize: 12, whiteSpace: 'nowrap'}}>두께: {penWidth}</span>
                <input type="range" min="1" max="50" value={penWidth} onChange={(e) => setPenWidth(parseInt(e.target.value))} style={{width: '100%', cursor: 'pointer'}} />
              </div>
              <div style={styles.colorGrid}>
                {colorPalette.map(c => (
                  <div key={c} onClick={() => setPenColor(c)} style={{ backgroundColor: c, width: 24, height: 24, borderRadius: '50%', border: penColor === c ? '2px solid #007bff' : '1px solid #ddd', cursor: 'pointer' }} />
                ))}
              </div>
            </div>
          )}
        </div>
        <button onClick={() => setTool('eraser')} style={tool === 'eraser' ? activeBtnStyle : btnStyle}><Eraser size={iconSize} /></button>
        <button onClick={handleClear} style={btnStyle} title="전체 삭제"><Trash2 size={iconSize} /></button>
        
        <div style={styles.dividerVertical} />
        
        <button onClick={handleUndo} disabled={currentStep === 0} style={currentStep === 0 ? disabledBtnStyle : btnStyle}><Undo size={iconSize} /></button>
        <button onClick={handleRedo} disabled={currentStep === history.length - 1} style={currentStep === history.length - 1 ? disabledBtnStyle : btnStyle}><Redo size={iconSize} /></button>
        
        <div style={styles.dividerVertical} />
        <button onClick={toggleFullScreen} style={btnStyle} title="전체화면">{isFullScreen ? <Minimize size={iconSize} /> : <Maximize size={iconSize} />}</button>

        <button onClick={shareBoard} style={shareBtnStyle}><Share2 size={iconSize} /> 질문발행</button>
      </div>

      {/* QR & 응답창 */}
      {showQR && (
        <div style={styles.qrPopup}>
          {/* 상단: 판서 내용 미리보기 */}
          {boardImage && (
            <div style={styles.boardPreview}>
              <div style={{fontSize: '14px', fontWeight: 'bold', color: '#555', marginBottom: '5px'}}>질문 내용</div>
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                <img src={boardImage} alt="판서 내용" style={{ maxWidth: '100%', maxHeight: '35vh', objectFit: 'contain', borderRadius: '4px' }} />
              </div>
            </div>
          )}

          {/* 하단: QR 코드 및 답변 목록 */}
          <div style={styles.qrContentRow}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 200 }}>
              <QRCodeCanvas value={`${window.location.origin}${window.location.pathname.replace(/\/$/, '')}/#/student?room=${roomId}`} size={160} />
              <p style={{margin: '15px 0 10px', fontSize: '16px'}}>Room ID: <strong>{roomId}</strong></p>
              <p style={{margin: '0 0 15px', color: '#666', fontSize: '14px'}}>QR코드를 스캔하여<br/>답변을 입력하세요.</p>
              <button onClick={handleCloseSession} style={styles.closeBtn}>질문 종료</button>
            </div>
            
            <div style={styles.dividerVertical}></div>

            <div style={styles.resSection}>
              <h4 style={{margin: '0 0 15px 0', display: 'flex', alignItems: 'center', gap: 8}}><MessageSquare size={18}/> 답변 목록 ({responses.length})</h4>
              <div style={styles.resList}>
                {responses.length === 0 ? (
                  <div style={{textAlign: 'center', color: '#999', marginTop: 50}}>아직 답변이 없습니다.</div>
                ) : (
                  responses.map(r => (
                    <div key={r.id} style={styles.resItem}><strong>{r.name}</strong>: {r.answer}</div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 종료 확인 모달 (전체화면 유지용) */}
      {showConfirmModal && (
        <div style={styles.confirmModalOverlay}>
          <div style={styles.confirmModalContent}>
            <p style={{marginBottom: '20px', fontSize: '16px', fontWeight: 'bold', color: '#333'}}>질문을 종료하시겠습니까?<br/><span style={{fontSize:'14px', fontWeight:'normal', color:'#666'}}>답변 데이터가 모두 삭제됩니다.</span></p>
            <div style={{display: 'flex', gap: '10px', justifyContent: 'center'}}>
              <button onClick={confirmCloseSession} style={{...styles.btn, background: '#ff4d4f', color: '#fff', padding: '8px 20px', borderRadius: '8px'}}>종료</button>
              <button onClick={() => setShowConfirmModal(false)} style={{...styles.btn, background: '#ddd', padding: '8px 20px', borderRadius: '8px'}}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  toolbar: { position: 'absolute', bottom: 50, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 10, background: '#fff', padding: '10px 20px', borderRadius: 30, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 100 },
  btn: { padding: 10, border: 'none', background: 'none', cursor: 'pointer', color: '#000' },
  disabledBtn: { padding: 10, border: 'none', background: 'none', cursor: 'not-allowed', color: '#ccc' },
  activeBtn: { padding: 10, border: 'none', background: '#ddd', borderRadius: 8, cursor: 'pointer' },
  shareBtn: { display: 'flex', alignItems: 'center', gap: 5, padding: '10px 15px', background: '#007bff', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 'bold' },
  qrPopup: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#fff', padding: 25, borderRadius: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 20, maxHeight: '90vh', maxWidth: '90vw', width: 'auto', zIndex: 200 },
  boardPreview: { width: '100%', background: '#f9f9f9', borderRadius: '8px', display: 'flex', flexDirection: 'column', padding: '10px', boxSizing: 'border-box' },
  qrContentRow: { display: 'flex', gap: 30, flex: 1, overflow: 'hidden' },
  resSection: { width: 300, display: 'flex', flexDirection: 'column' },
  resList: { overflowY: 'auto', flex: 1, paddingRight: 5 },
  resItem: { background: '#f8f9fa', padding: 12, borderRadius: 8, marginBottom: 10, fontSize: '14px', border: '1px solid #eee', color: '#333' },
  closeBtn: { padding: '10px 20px', background: '#ff4d4f', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold', width: '100%' },
  dividerVertical: { width: 1, background: '#eee' },
  confirmModalOverlay: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', justifyContent: 'center', alignItems: 'center' },
  confirmModalContent: { background: '#fff', padding: '25px', borderRadius: '15px', textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minWidth: '300px' },
  penSettingsPopup: { position: 'absolute', bottom: '120%', left: '50%', transform: 'translateX(-50%)', background: '#fff', padding: 15, borderRadius: 15, boxShadow: '0 5px 20px rgba(0,0,0,0.2)', width: 220, zIndex: 110 },
  colorGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }
};

export default PenQR;