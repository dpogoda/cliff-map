'use client';

import dynamic from 'next/dynamic';

// Dynamically import DemMap to avoid SSR issues with MapLibre
const DemMap = dynamic(() => import('./components/DemMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-zinc-50 dark:bg-black">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-zinc-300 border-t-zinc-700 rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-lg font-medium text-zinc-700 dark:text-zinc-300">
          Initializing map...
        </p>
      </div>
    </div>
  ),
});

export default function MapPage() {
  return (
    <div className="w-full h-screen">
      <DemMap initialLocation="alps" />
    </div>
  );
}
