import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Account & Sign In',
  description:
    'Connectez-vous à votre compte Lis et Lead pour retrouver votre bibliothèque sur tous vos appareils.',
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
