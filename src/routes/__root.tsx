import { Outlet, createRootRoute } from '@tanstack/react-router';
import { AppShell } from '@ui/AppShell';

export const Route = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  )
});
