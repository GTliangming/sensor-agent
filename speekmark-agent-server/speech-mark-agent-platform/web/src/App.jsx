import { Navigate, Route, Routes } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Assistant from './pages/Assistant';
import Runs from './pages/Runs';
import RunDetail from './pages/RunDetail';
import Approvals from './pages/Approvals';
import Knowledge from './pages/Knowledge';
import Settings from './pages/Settings';
export default function App(){return <Routes><Route element={<MainLayout/>}><Route path="/" element={<Dashboard/>}/><Route path="/assistant" element={<Assistant/>}/><Route path="/runs" element={<Runs/>}/><Route path="/runs/:runId" element={<RunDetail/>}/><Route path="/approvals" element={<Approvals/>}/><Route path="/knowledge" element={<Knowledge/>}/><Route path="/settings" element={<Settings/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Route></Routes>}
