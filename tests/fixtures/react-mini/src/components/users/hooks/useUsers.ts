import { fetchUsers } from '@/services/userService';
import { userAtom } from '@/atoms/user';

export const useUsers = () => (userAtom ? fetchUsers() : []);
