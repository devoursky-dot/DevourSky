import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Firebase 콘솔 -> 프로젝트 설정 -> 내 앱에서 복사한 키를 붙여넣으세요.
const firebaseConfig = {
  apiKey: "AIzaSyBx44NfL4xrYU7v549WEDBqzgSvZEB3OmI",
  authDomain: "penqr-f5712.firebaseapp.com",
  projectId: "penqr-f5712",
  storageBucket: "penqr-f5712.firebasestorage.app",
  messagingSenderId: "999611108499",
  appId: "1:999611108499:web:86ea65ebe65cff78399166"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);