import { Navigate, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import VideoPage from "./pages/VideoPage";
import PublishPage from "./pages/PublishPage";
import StudioPage from "./studio/StudioPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/video/:id" element={<VideoPage />} />
      <Route path="/studio" element={<StudioPage />} />
      <Route path="/publish" element={<PublishPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
