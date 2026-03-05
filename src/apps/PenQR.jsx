import React, { useRef, useState, useEffect, useCallback } from 'react';
import { getStroke } from 'perfect-freehand';
import { QRCodeCanvas } from 'qrcode.react';
import { Pencil, Eraser, Trash2, Share2, MessageSquare, Undo, Redo } from 'lucide-react';

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

const PenQR = () => {
  const [history, setHistory] = useState([[]]); // 전체 히스토리 저장
  const [currentStep, setCurrentStep] = useState(0); // 현재 히스토리 단계
  const strokes = history[currentStep]; // 현재 보여줄 스트로크
  const strokesRef = useRef([]); // 그리기 데이터의 즉각적인 참조를 위한 Ref
  const [tool, setTool] = useState('pen');
  const [showQR, setShowQR] = useState(false);
  const [responses, setResponses] = useState([]);
  const [boardImage, setBoardImage] = useState(null); // 캡처된 판서 이미지 저장
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const currentPoints = useRef([]);
  const [roomId] = useState(() => Math.random().toString(36).substring(2, 8).toUpperCase()); // 랜덤 룸 ID 생성

  // [추가] 앱 실행 시 전체 화면 모드 전환 시도
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
  }, []);

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
    draw();
  }, [strokes]);

  // 2. 판서 데이터 Firebase 업로드 (공유 버튼 클릭 시)
  const shareBoard = async () => {
    // 현재 캔버스 내용을 이미지로 캡처
    if (canvasRef.current) {
      setBoardImage(canvasRef.current.toDataURL());
    }

    await setDoc(doc(db, "rooms", roomId), {
      strokes: JSON.stringify(strokes),
      width: canvasRef.current ? canvasRef.current.width : window.innerWidth,
      height: canvasRef.current ? canvasRef.current.height : window.innerHeight,
      updatedAt: new Date()
    });
    setShowQR(true);
  };

  const handleCloseSession = async () => {
    if (window.confirm("질문을 종료하시겠습니까? 답변 데이터가 모두 삭제됩니다.")) {
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
    }
  };

  // --- 드로잉 로직 ---
  const draw = useCallback(() => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    // strokes 상태 대신 strokesRef를 사용하여 깜빡임 방지
    [...strokesRef.current, { points: currentPoints.current, tool }].forEach(s => {
      if (!s.points.length) return;
      const outline = getStroke(s.points, { size: s.tool === 'eraser' ? 25 : 5 });
      const path = new Path2D(getSvgPathFromStroke(outline));
      ctx.fillStyle = s.tool === 'eraser' ? '#fff' : '#000';
      ctx.fill(path);
    });
  }, [tool]); // strokes 의존성 제거 (Ref 사용)

  const onPointerDown = (e) => {
    isDrawing.current = true;
    currentPoints.current = [[e.clientX, e.clientY, e.pressure]];
    requestAnimationFrame(draw);
  };

  const onPointerMove = (e) => {
    if (!isDrawing.current) return;
    currentPoints.current.push([e.clientX, e.clientY, e.pressure]);
    requestAnimationFrame(draw);
  };

  const onPointerUp = () => {
    isDrawing.current = false;
    // [FIX] 상태 업데이트 전에 현재 포인트를 복사해야 함 (비동기 처리 시점 문제 해결)
    const newPoints = [...currentPoints.current];
    if (newPoints.length > 0) {
      const newStroke = { points: newPoints, tool };
      const newStrokes = [...strokes, newStroke];
      strokesRef.current = newStrokes; // Ref 즉시 업데이트로 공백 제거
      
      const newHistory = history.slice(0, currentStep + 1);
      newHistory.push(newStrokes);
      setHistory(newHistory);
      setCurrentStep(newHistory.length - 1);
    }
    currentPoints.current = [];
    draw(); // 즉시 다시 그려서 화면 유지
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

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#eee' }}>
      <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} 
        width={window.innerWidth} height={window.innerHeight} style={{ background: '#fff', touchAction: 'none' }} />
      
      {/* 툴바 */}
      <div style={styles.toolbar}>
        <button onClick={() => setTool('pen')} style={tool === 'pen' ? styles.activeBtn : styles.btn}><Pencil /></button>
        <button onClick={() => setTool('eraser')} style={tool === 'eraser' ? styles.activeBtn : styles.btn}><Eraser /></button>
        <button onClick={handleClear} style={styles.btn} title="전체 삭제"><Trash2 /></button>
        
        <div style={styles.dividerVertical} />
        
        <button onClick={handleUndo} disabled={currentStep === 0} style={currentStep === 0 ? styles.disabledBtn : styles.btn}><Undo /></button>
        <button onClick={handleRedo} disabled={currentStep === history.length - 1} style={currentStep === history.length - 1 ? styles.disabledBtn : styles.btn}><Redo /></button>
        
        <button onClick={shareBoard} style={styles.shareBtn}><Share2 /> 질문발행</button>
      </div>

      {/* QR & 응답창 */}
      {showQR && (
        <div style={styles.qrPopup}>
          {/* 상단: 판서 내용 미리보기 */}
          {boardImage && (
            <div style={styles.boardPreview}>
              <div style={{fontSize: '14px', fontWeight: 'bold', color: '#555', marginBottom: '5px'}}>질문 내용</div>
              <img src={boardImage} alt="판서 내용" style={{width: '100%', height: 'auto', objectFit: 'contain', border: '1px solid #eee', borderRadius: '8px'}} />
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
    </div>
  );
};

const styles = {
  toolbar: { position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 10, background: '#fff', padding: '10px 20px', borderRadius: 30, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 100 },
  btn: { padding: 10, border: 'none', background: 'none', cursor: 'pointer', color: '#000' },
  disabledBtn: { padding: 10, border: 'none', background: 'none', cursor: 'not-allowed', color: '#ccc' },
  activeBtn: { padding: 10, border: 'none', background: '#ddd', borderRadius: 8, cursor: 'pointer' },
  shareBtn: { display: 'flex', alignItems: 'center', gap: 5, padding: '10px 15px', background: '#007bff', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 'bold' },
  qrPopup: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#fff', padding: 25, borderRadius: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 20, maxHeight: '90vh', maxWidth: '90vw', width: 'auto' },
  boardPreview: { width: '100%', height: 'auto', minHeight: '200px', maxHeight: '40vh', background: '#f9f9f9', borderRadius: '8px', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  qrContentRow: { display: 'flex', gap: 30, flex: 1, overflow: 'hidden' },
  resSection: { width: 300, display: 'flex', flexDirection: 'column' },
  resList: { overflowY: 'auto', flex: 1, paddingRight: 5 },
  resItem: { background: '#f8f9fa', padding: 12, borderRadius: 8, marginBottom: 10, fontSize: '14px', border: '1px solid #eee', color: '#333' },
  closeBtn: { padding: '10px 20px', background: '#ff4d4f', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold', width: '100%' },
  dividerVertical: { width: 1, background: '#eee' }
};

export default PenQR;