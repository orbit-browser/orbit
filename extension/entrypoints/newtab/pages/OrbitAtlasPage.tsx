import { useEffect } from 'react';
import { VariantAtlasReplica } from '../components/VariantAtlasReplica';

export function OrbitAtlasPage() {
  useEffect(() => {
    document.documentElement.classList.add('atlas-mode');
    return () => document.documentElement.classList.remove('atlas-mode');
  }, []);

  return <VariantAtlasReplica />;
}
