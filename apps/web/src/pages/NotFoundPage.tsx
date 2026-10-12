import { Link } from 'react-router-dom';
import { Section } from '@/components/site-shell';
import { Button, Card, Pill } from '@/components/ui';
import { GavelIcon, LiveDot, MoneyMartMark, SearchIcon, StoreIcon } from '@/components/icons';

/** 404 — keeps the premium tone and routes people back into the platform. */
export default function NotFoundPage() {
  return (
    <Section>
      <Card className="mx-auto max-w-2xl p-10 text-center">
        <div className="mb-6 flex justify-center">
          <MoneyMartMark size={44} withWordmark tagline />
        </div>

        <p className="data text-[64px] font-bold leading-none" style={{ color: 'var(--mm-gold)' }}>
          404
        </p>
        <h1 className="mt-3 text-[clamp(22px,3vw,32px)] text-white">This lot has been withdrawn</h1>
        <p className="mx-auto mt-3 max-w-md text-[13.5px] leading-relaxed text-white/60">
          The page you were after is not on the block. It may have been sold, moved, or the link may be mistyped.
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/live">
            <Button variant="gold" size="lg" icon={<LiveDot size={9} />}>
              Watch live rooms
            </Button>
          </Link>
          <Link to="/auctions">
            <Button variant="navy" size="lg" icon={<GavelIcon size={16} />}>
              Browse auctions
            </Button>
          </Link>
          <Link to="/search">
            <Button variant="ghost" size="lg" icon={<SearchIcon size={16} />}>
              Search
            </Button>
          </Link>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Pill tone="green">Live 24/7</Pill>
          <Pill tone="gold">MV Verified</Pill>
          <Pill>
            <StoreIcon size={11} /> Studio storefronts
          </Pill>
        </div>
      </Card>
    </Section>
  );
}
