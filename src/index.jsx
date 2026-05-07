/**
 * @fileoverview Punto de entrada de la aplicación — importa estilos globales
 * y monta el componente App en el nodo #root del HTML.
 * @module index
 */
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/styles.css';

createRoot(document.getElementById('root')).render(<App />);
