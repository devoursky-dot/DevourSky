import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import SmartBoardApp from './apps/SmartBoard_app';
import PenQR from './apps/PenQR';
import PenQR_SP from './apps/PenQR_SP';
import dragonImage from './assets/devoursky.svg';
import { Home, Menu, Maximize, Minimize, Info, X, Cpu, MemoryStick, Fingerprint, Monitor, Activity, QrCode } from 'lucide-react';

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
    src={dragonImage}
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
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showSysInfo, setShowSysInfo] = useState(false);
  const [showPenQR, setShowPenQR] = useState(false);
  const [systemData, setSystemData] = useState(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    const handleFullScreenChange = () => setIsFullScreen(!!document.fullscreenElement);

    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', handleFullScreenChange);

    // 홈 화면 진입 시 전체화면 시도 (브라우저 정책에 따라 차단될 수 있음)
    document.documentElement.requestFullscreen().catch(() => {});

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('fullscreenchange', handleFullScreenChange);
    };
  }, []);

  const handleSystemCheck = () => {
    const info = {
      cpu: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} Logical Cores` : 'Unknown',
      ram: navigator.deviceMemory ? `~${navigator.deviceMemory} GiB` : 'Unknown / Restricted',
      touch: navigator.maxTouchPoints > 0 
        ? `Supported (${navigator.maxTouchPoints} Points)` 
        : 'Not Supported',
      userAgent: navigator.userAgent,
      gpu: 'Unknown',
      resolution: `${window.screen.width} x ${window.screen.height}`,
      pixelRatio: window.devicePixelRatio || 1
    };

    // GPU 정보 (Chipset 추정용)
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          info.gpu = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch (e) {
      console.error("WebGL Info Error", e);
    }

    setSystemData(info);
    setShowSysInfo(true);
  };

  const isMobile = windowWidth < 768;

  // [FIX] 학생 페이지 라우팅 (QR코드 스캔 시 접속)
  if (window.location.pathname === '/student') {
    return <PenQR_SP />;
  }

  if (showSmartBoard) {
    return (
      <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
        <SmartBoardApp />
        {/* 우측 상단 메뉴 버튼 (드롭다운) */}
        <div style={{
          position: 'absolute',
          top: 0,
          right: 0,
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end'
        }}>
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            style={{
              background: 'rgba(0, 0, 0, 0.8)',
              border: 'none',
              borderBottomLeftRadius: isMenuOpen ? '0' : '15px',
              padding: '12px',
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'border-radius 0.2s'
            }}
            title="Menu"
          >
            <Menu size={24} />
          </button>
          
          {isMenuOpen && (
            <div style={{
              background: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(4px)',
              borderBottomLeftRadius: '15px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minWidth: '140px'
            }}>
              <button
                onClick={() => {
                  if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(e => console.log(e));
                  } else {
                    if (document.exitFullscreen) document.exitFullscreen().catch(e => console.log(e));
                  }
                  setIsMenuOpen(false);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '12px 16px',
                  color: 'white',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '14px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                  width: '100%'
                }}
              >
                {isFullScreen ? (
                  <><Minimize size={18} /> Exit Fullscreen</>
                ) : (
                  <><Maximize size={18} /> Fullscreen</>
                )}
              </button>
              <button
                onClick={() => {
                  setShowSmartBoard(false);
                  setIsMenuOpen(false);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '12px 16px',
                  color: 'white',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '14px',
                  width: '100%'
                }}
              >
                <Home size={18} /> Home
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (showPenQR) {
    return (
      <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
        <PenQR />
        <button
          onClick={() => setShowPenQR(false)}
          style={{
            position: 'absolute', top: '20px', right: '20px', zIndex: 100,
            background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none',
            borderRadius: '50%', width: '40px', height: '40px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', backdropFilter: 'blur(4px)'
          }}
          title="Home"
        >
          <Home size={20} />
        </button>
      </div>
    );
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
      {/* 상단 메뉴바 */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        padding: '15px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 30,
        boxSizing: 'border-box',
        borderBottom: '1px solid rgba(255, 255, 255, 0.8)'
      }}>
        <div style={{ 
          color: 'white', 
          fontSize: '20px', 
          fontWeight: 'bold', 
          letterSpacing: '2px',
          textShadow: '0 0 10px rgba(255,255,255,0.5)'
        }}>
          DevourSky
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={handleSystemCheck}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.7)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '12px'
            }}
            title="System Info"
          >
            <Info size={18} /> <span style={{ display: isMobile ? 'none' : 'inline' }}>Sys Info</span>
          </button>

          <button
            onClick={() => setShowPenQR(true)}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '20px',
              padding: '8px 15px',
              color: 'white',
              fontSize: '14px',
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
          >
            <QrCode size={16} /> <span style={{ display: isMobile ? 'none' : 'inline' }}>Pen QR</span>
          </button>

          <button
            onClick={() => setShowSmartBoard(true)}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '20px',
              padding: '8px 20px',
              color: 'white',
              fontSize: '14px',
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
          >
            Smart Board
          </button>
        </div>
      </div>

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
          bottom: isMobile ? '80px' : '50px',
          zIndex: 20,
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '30px',
          padding: isMobile ? '10px 24px' : '12px 40px',
          color: 'rgba(255, 255, 255, 0.6)',
          fontSize: isMobile ? '14px' : '16px',
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

      {/* 시스템 정보 팝업 */}
      {showSysInfo && systemData && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 200,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          backdropFilter: 'blur(5px)'
        }} onClick={() => setShowSysInfo(false)}>
          <div style={{
            width: '90%', maxWidth: '500px',
            backgroundColor: 'rgba(20, 20, 30, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '16px', padding: '24px',
            color: 'white', boxShadow: '0 0 30px rgba(0, 150, 255, 0.2)',
            position: 'relative'
          }} onClick={e => e.stopPropagation()}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Activity size={20} color="#6366f1" /> System Information
              </h3>
              <button onClick={() => setShowSysInfo(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gap: '15px' }}>
              <div style={infoRowStyle}>
                <div style={infoLabelStyle}><Cpu size={16} /> CPU (Threads)</div>
                <div style={infoValueStyle}>{systemData.cpu}</div>
              </div>
              <div style={infoRowStyle}>
                <div style={infoLabelStyle}><Monitor size={16} /> GPU / Chipset</div>
                <div style={infoValueStyle}>{systemData.gpu}</div>
              </div>
              <div style={infoRowStyle}>
                <div style={infoLabelStyle}><MemoryStick size={16} /> RAM (Approx)</div>
                <div style={infoValueStyle}>{systemData.ram}</div>
              </div>
              <div style={infoRowStyle}>
                <div style={infoLabelStyle}><Fingerprint size={16} /> Touch Sensor</div>
                <div style={infoValueStyle}>{systemData.touch}</div>
              </div>
              <div style={infoRowStyle}>
                <div style={infoLabelStyle}><Monitor size={16} /> Resolution</div>
                <div style={infoValueStyle}>{systemData.resolution} (Px Ratio: {systemData.pixelRatio})</div>
              </div>
            </div>
            
            <div style={{ marginTop: '20px', fontSize: '11px', color: '#666', textAlign: 'center' }}>
              * 브라우저 보안 정책상 일부 하드웨어 정보는 근사치이거나 숨겨질 수 있습니다.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const infoRowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' };
const infoLabelStyle = { display: 'flex', alignItems: 'center', gap: '8px', color: '#aaa', fontSize: '14px' };
const infoValueStyle = { fontWeight: 'bold', color: '#fff', fontSize: '14px', textAlign: 'right', maxWidth: '60%' };

export default DevourskyWhiteLineBackground;