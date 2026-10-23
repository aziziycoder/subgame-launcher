import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: "AIzaSyBeARpvr_M-_p8OfO23a1AkSOS5WmNxDDE",
  authDomain: "subgame-ca4ed.firebaseapp.com",
  projectId: "subgame-ca4ed",
  storageBucket: "subgame-ca4ed.firebasestorage.app",
  messagingSenderId: "542403988321",
  appId: "1:542403988321:web:ba209d33a0d77594f0d320",
  measurementId: "G-6518SQBXWN"
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
