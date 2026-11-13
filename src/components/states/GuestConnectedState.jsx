import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
export default function GuestConnectedState(){
 return <div className="rounded-2xl border border-border bg-surface p-6"><h2 className="text-lg font-semibold text-foreground">Connected services use your account</h2><p className="mt-2 text-muted-foreground">Explore bills, budgets, goals and planning with sample data. Create an account to choose AI sharing, search current jobs or connect a test bank.</p><Button asChild className="mt-5 min-h-11"><Link to="/register">Create account</Link></Button></div>;
}
