// in App.js or the file where you define routes
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Login from "./pages/Login";
import MemberPage from "./pages/MemberPage";
// import Navbar etc.

function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/member/:id" element={<MemberPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

