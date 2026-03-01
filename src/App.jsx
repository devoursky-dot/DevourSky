import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import SmartBoardApp from './apps/SmartBoard_app';

// 유명한 우주 배경 효과 (Starfield / Galaxy Warp)
const GalaxyBackground = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    const stars = [];
    const numStars = 800; // 별의 개수
    const speed = 2; // 별이 다가오는 속도

    // 별 초기화
    for (let i = 0; i < numStars; i++) {
      stars.push({
        x: Math.random() * canvas.width - canvas.width / 2,
        y: Math.random() * canvas.height - canvas.height / 2,
        z: Math.random() * canvas.width
      });
    }

    const animate = () => {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      stars.forEach(star => {
        star.z -= speed;
        if (star.z <= 0) {
          star.z = canvas.width;
          star.x = Math.random() * canvas.width - canvas.width / 2;
          star.y = Math.random() * canvas.height - canvas.height / 2;
        }

        const x = (star.x / star.z) * canvas.width + canvas.width / 2;
        const y = (star.y / star.z) * canvas.height + canvas.height / 2;
        const size = (1 - star.z / canvas.width) * 3;

        if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
          ctx.beginPath();
          ctx.fillStyle = 'white';
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />;
};

// 용의 각 부위를 렌더링하는 컴포넌트
const DragonPart = ({ clipPath, origin, animate, transition, zIndex }) => (
  <motion.img
    src="/src/assets/devoursky.svg"
    alt="Devoursky Dragon Part"
    style={{
      position: 'absolute',
      width: '100%',
      height: '100%',
      objectFit: 'contain', // 비율 유지
      filter: 'invert(1) drop-shadow(0 15px 15px rgba(135, 206, 235, 0.8))', // 푸른빛이 도는 은색 그림자로 신비로운 느낌 추가
      opacity: 0.8,
      mixBlendMode: 'screen', // 배경과 자연스럽게 합성
      clipPath: clipPath, // 부위별 자르기
      transformOrigin: origin, // 회전 축 설정
      zIndex: zIndex,
    }}
    animate={animate}
    transition={transition}
  />
);

const DevourskyWhiteLineBackground = () => {
  const [showSmartBoard, setShowSmartBoard] = useState(false);

  if (showSmartBoard) {
    return <SmartBoardApp />;
  }

  return (
    <div style={{ 
      backgroundColor: 'black', 
      width: '100vw', 
      height: '100vh', 
      position: 'relative', 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center',
      overflow: 'hidden' 
    }}>
      {/* 1. 우주 별 배경 (Canvas Galaxy) */}
      <GalaxyBackground />

      {/* 2. 메인 Devoursky 이미지 (아이들 애니메이션 적용) */}
      <motion.div
        style={{ 
          width: '95%', 
          height: '95%', 
          position: 'absolute', 
          zIndex: 10,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}
        animate={{ 
          y: [0, -10, 0], // 전체적으로 살짝 위아래로 부유하는 느낌
          scale: [1, 1.01, 1] // 전체적으로 아주 미세하게 커졌다 작아지는 숨쉬는 느낌
        }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* 전체 용 이미지 (분할 없이 하나로 통일하여 자연스럽게 연출) */}
        <DragonPart zIndex={10} />
      </motion.div>

      {/* 3. 소용돌이(우주 삼키는 효과) 가상 요소 - 선택 사항 */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        style={{
          position: 'absolute',
          width: '80vw',
          height: '80vw',
          maxWidth: '800px',
          maxHeight: '800px',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: '50%',
          boxShadow: 'inset 0 0 40px rgba(200, 200, 255, 0.05)',
          zIndex: 5
        }}
      />

      {/* 4. 판서앱 연결 투명 버튼 */}
      <button
        onClick={() => setShowSmartBoard(true)}
        style={{
          position: 'absolute',
          bottom: '50px',
          zIndex: 20,
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '30px',
          padding: '12px 40px',
          color: 'rgba(255, 255, 255, 0.6)',
          fontSize: '16px',
          letterSpacing: '2px',
          cursor: 'pointer',
          backdropFilter: 'blur(4px)',
          transition: 'all 0.3s ease',
          outline: 'none'
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
          e.currentTarget.style.color = 'white';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
          e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        }}
      >
        ENTER SMART BOARD
      </button>
    </div>
  );
};

export default DevourskyWhiteLineBackground;