import React, { useRef, useState, useEffect, useCallback } from 'react';
import { getStroke } from 'perfect-freehand';
import { QRCodeCanvas } from 'qrcode.react';
import { Pencil, Eraser, RotateCcw, Trash2, Share2, MessageSquare, X } from 'lucide-react';

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
  const [strokes, setStrokes] = useState([]);
  const strokesRef = useRef([]); // 그리기 데이터의 즉각적인 참조를 위한 Ref
  const [tool, setTool] = useState('pen');
  const [showQR, setShowQR] = useState(false);
  const [responses, setResponses] = useState([]);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const currentPoints = useRef([]);
  const roomId = "ROOM_01"; // 고정 룸 ID (필요시 가변)

  // 1. 학생 답변 실시간 수신
  useEffect(() => {
    const q = query(collection(db, "rooms", roomId, "answers"), orderBy("timestamp", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setResponses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  // strokes 상태가 변경되면 ref도 동기화 (Undo/Redo 등 외부 변경 대응)
  useEffect(() => {
    strokesRef.current = strokes;
    draw();
  }, [strokes]);

  // 2. 판서 데이터 Firebase 업로드 (공유 버튼 클릭 시)
  const shareBoard = async () => {
    await setDoc(doc(db, "rooms", roomId), {
      strokes: JSON.stringify(strokes),
      updatedAt: new Date()
    });
    setShowQR(true);
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
      strokesRef.current = [...strokesRef.current, newStroke]; // Ref 즉시 업데이트로 공백 제거
      setStrokes(prev => [...prev, newStroke]);
    }
    currentPoints.current = [];
    draw(); // 즉시 다시 그려서 화면 유지
  };


  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#eee' }}>
      <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} 
        width={window.innerWidth} height={window.innerHeight} style={{ background: '#fff', touchAction: 'none' }} />
      
      {/* 툴바 */}
      <div style={styles.toolbar}>
        <button onClick={() => setTool('pen')} style={tool === 'pen' ? styles.activeBtn : styles.btn}><Pencil /></button>
        <button onClick={() => setTool('eraser')} style={tool === 'eraser' ? styles.activeBtn : styles.btn}><Eraser /></button>
        <button onClick={() => setStrokes(prev => prev.slice(0, -1))} style={styles.btn}><RotateCcw /></button>
        <button onClick={shareBoard} style={styles.shareBtn}><Share2 /> 질문발행</button>
      </div>

      {/* QR & 응답창 */}
      {showQR && (
        <div style={styles.qrPopup}>
          <QRCodeCanvas value={`${window.location.origin}${window.location.pathname}#/student`} size={150} />
          <p>QR 스캔 후 답변!</p>
          <button onClick={() => setShowQR(false)}>닫기</button>
        </div>
      )}

      <div style={styles.resPanel}>
        <h4 style={{margin: '0 0 10px 0'}}><MessageSquare size={16}/> 답변 목록 ({responses.length})</h4>
        <div style={{overflowY: 'auto', flex: 1}}>
          {responses.map(r => (
            <div key={r.id} style={styles.resItem}><strong>{r.name}</strong>: {r.answer}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

const styles = {
  toolbar: { position: 'absolute', left: 20, top: 20, display: 'flex', gap: 10, background: '#fff', padding: 10, borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.1)' },
  btn: { padding: 10, border: 'none', background: 'none', cursor: 'pointer' },
  activeBtn: { padding: 10, border: 'none', background: '#ddd', borderRadius: 8, cursor: 'pointer' },
  shareBtn: { display: 'flex', alignItems: 'center', gap: 5, padding: '10px 15px', background: '#007bff', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 'bold' },
  qrPopup: { position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', background: '#fff', padding: 20, borderRadius: 15, textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' },
  resPanel: { position: 'absolute', right: 20, top: 20, bottom: 20, width: 250, background: 'rgba(255,255,255,0.9)', padding: 15, borderRadius: 15, display: 'flex', flexDirection: 'column' },
  resItem: { background: '#fff', padding: 8, borderRadius: 8, marginBottom: 8, fontSize: '14px', border: '1px solid #eee', color: '#000' }
};

export default PenQR;