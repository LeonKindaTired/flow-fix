import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { theme } from '../src/theme';

export default function Layout() {
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.backgroundColor = theme.bg;
      document.documentElement.style.colorScheme = 'dark';
      const meta = document.querySelector('meta[name="theme-color"]') ?? document.createElement('meta');
      meta.setAttribute('name', 'theme-color'); meta.setAttribute('content', theme.bg);
      if (!meta.parentNode) document.head.appendChild(meta);
      document.body.style.backgroundColor = theme.bg;
      document.body.style.color = theme.text;
    }
  }, []);
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />;
}
