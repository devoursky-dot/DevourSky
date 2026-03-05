import React, { useState, useEffect } from 'react';
import { getStroke } from 'perfect-freehand';

import { db } from './PenQR_conf';
import { doc, onSnapshot, collection, addDoc, serverTimestamp } from 'firebase/firestore';

// 벡터 렌더링용 유틸
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

const PenQR_SP = () => {
  const [boardData, setBoardData] = useState([]);
  const [name, setName] = useState('');
  const [answer, setAnswer] = useState('');
  const [sent, setSent] = useState(false);
  const [roomId, setRoomId] = useState(null);

  useEffect(() => {
    // URL의 search(?room=...) 또는 hash(#...?room=...)에서 room ID 추출
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.split('?')[1]);
    
    const id = searchParams.get('room') || hashParams.get('room');
    setRoomId(id);
  }, []);

  // 1. 선생님 판서 실시간 데이터 수신
  useEffect(() => {
    if (!roomId) return;
    const unsubscribe = onSnapshot(doc(db, "rooms", roomId), (doc) => {
      if (doc.exists()) {
        setBoardData(JSON.parse(doc.data().strokes || "[]"));
      }
    });
    return () => unsubscribe();
  }, [roomId]);

  const submit = async () => {
    if (!roomId) return alert("유효하지 않은 방입니다. QR코드를 다시 스캔해주세요.");
    if (!name || !answer) return alert("이름과 답변을 입력하세요!");
    await addDoc(collection(db, "rooms", roomId, "answers"), {
      name, answer, timestamp: serverTimestamp()
    });
    setSent(true);
  };

  return (
    <div style={{ padding: 20, maxWidth: 500, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2 style={{ textAlign: 'center' }}>PenQR 참여</h2>
      
      {/* 선생님 판서 보기 (벡터 렌더링) */}
      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 10, marginBottom: 20, height: 200, overflow: 'hidden' }}>
        <svg viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`} style={{ width: '100%', height: '100%' }}>
          {boardData.map((s, i) => (
            <path key={i} d={getSvgPathFromStroke(getStroke(s.points, { size: s.tool === 'eraser' ? 20 : 5 }))} 
              fill={s.tool === 'eraser' ? '#fff' : '#000'} />
          ))}
        </svg>
      </div>

      {!sent ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input placeholder="이름" value={name} onChange={e => setName(e.target.value)} style={styles.input} />
          <textarea placeholder="답변을 입력하세요" value={answer} onChange={e => setAnswer(e.target.value)} style={styles.textarea} />
          <button onClick={submit} style={styles.btn}>답변 보내기</button>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 20 }}>🎉 답변이 전송되었습니다!</div>
      )}
    </div>
  );
};

const styles = {
  input: { padding: 12, borderRadius: 8, border: '1px solid #ddd' },
  textarea: { padding: 12, borderRadius: 8, border: '1px solid #ddd', height: 100 },
  btn: { padding: 15, borderRadius: 8, border: 'none', background: '#007bff', color: '#fff', fontWeight: 'bold' }
};

export default PenQR_SP;