import type { User } from '@/types/user';
import { Button } from '@/components/ui/button';
import { useUsers } from './hooks/useUsers';

export function UserList() {
  const users: User[] = useUsers();
  return <ul>{users.length > 0 ? users.map((u) => <Button key={u.id} label={u.name} />) : null}</ul>;
}
