import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { LanguageProvider } from './i18n/index.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import './styles/global.css'
ReactDOM.createRoot(document.getElementById('root')).render(
  <LanguageProvider><ThemeProvider><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></ThemeProvider></LanguageProvider>)
