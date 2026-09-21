import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initPermalink } from './lib/permalink.js';
import './styles/app.css';

// Restore camera / mode / selected flight from a shared link before the first render.
initPermalink();

createRoot(document.getElementById('root')).render(<App />);
