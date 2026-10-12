/**
 * MoneyMart web — app root.
 * Router + providers + the persistent site shell (header, footer, mobile tabs).
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Providers } from './providers';
import { MobileTabBar, SiteFooter, SiteHeader } from './components/site-shell';
import { ScrollToTop } from './components/ScrollToTop';
import LandingPage from './pages/LandingPage';
import LivePage from './pages/LivePage';
import StreamPage from './pages/StreamPage';
import AuctionsPage from './pages/AuctionsPage';
import AuctionDetailPage from './pages/AuctionDetailPage';
import MarketplacePage from './pages/MarketplacePage';
import CreatorsPage from './pages/CreatorsPage';
import CreatorProfilePage from './pages/CreatorProfilePage';
import SellPage from './pages/SellPage';
import StudioPage from './pages/StudioPage';
import AccountPage from './pages/AccountPage';
import WalletPage from './pages/WalletPage';
import OrdersPage from './pages/OrdersPage';
import SettingsPage from './pages/SettingsPage';
import SellingPage from './pages/SellingPage';
import NotificationsPage from './pages/NotificationsPage';
import SearchPage from './pages/SearchPage';
import AdminPage from './pages/AdminPage';
import NotFoundPage from './pages/NotFoundPage';

export function App() {
  return (
    <BrowserRouter>
      <Providers>
        <ScrollToTop />
        <SiteHeader />
        <main className="min-h-[70vh] pb-24 md:pb-0">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/live" element={<LivePage />} />
            <Route path="/stream/:id" element={<StreamPage />} />
            <Route path="/auctions" element={<AuctionsPage />} />
            <Route path="/auctions/:id" element={<AuctionDetailPage />} />
            <Route path="/marketplace" element={<MarketplacePage />} />
            <Route path="/creators" element={<CreatorsPage />} />
            <Route path="/creators/:handle" element={<CreatorProfilePage />} />
            <Route path="/seller/:handle" element={<CreatorProfilePage />} />
            {/* Published Studio storefronts share the creator profile renderer. */}
            <Route path="/shop/:handle" element={<CreatorProfilePage />} />
            <Route path="/sell" element={<SellPage />} />
            <Route path="/sell/:track" element={<SellPage />} />
            <Route path="/studio" element={<StudioPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/account/wallet" element={<WalletPage />} />
            <Route path="/account/orders" element={<OrdersPage />} />
            <Route path="/account/selling" element={<SellingPage />} />
            <Route path="/account/settings" element={<SettingsPage />} />
            <Route path="/orders" element={<Navigate to="/account/orders" replace />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
        <SiteFooter />
        <MobileTabBar />
      </Providers>
    </BrowserRouter>
  );
}

export default App;
