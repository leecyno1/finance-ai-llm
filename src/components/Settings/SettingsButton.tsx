import { Settings } from 'lucide-react';
import { useState } from 'react';
import SettingsDialogue from './SettingsDialogue';
import { AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

const SettingsButton = ({ compact = false }: { compact?: boolean }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <>
      <div
        className={cn(
          'rounded-full bg-light-200 text-black/70 dark:bg-dark-200 dark:text-white/70 hover:opacity-70 hover:scale-105 transition duration-200 cursor-pointer active:scale-95',
          compact ? 'p-2.5' : 'p-2.5',
        )}
        onClick={() => setIsOpen(true)}
      >
        <Settings size={compact ? 16 : 19} className="cursor-pointer" />
      </div>
      <AnimatePresence>
        {isOpen && <SettingsDialogue isOpen={isOpen} setIsOpen={setIsOpen} />}
      </AnimatePresence>
    </>
  );
};

export default SettingsButton;
