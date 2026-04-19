// index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './routes/App.jsx';
import './styles/global.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import "prismjs/themes/prism.css";                       // or prism-okaidia.css, etc.
import "prismjs/plugins/line-numbers/prism-line-numbers.css";
// If using toolbar: import "prismjs/plugins/toolbar/prism-toolbar.css";


const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
