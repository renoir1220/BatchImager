import type { ComponentPropsWithoutRef, ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

interface OsDialogProps extends Omit<ComponentPropsWithoutRef<typeof Dialog.Content>, "children" | "className"> {
  children: ReactNode;
  contentClassName: string;
  onClose: () => void;
  overlayClassName?: string;
}

export function OsDialog({
  children,
  contentClassName,
  onClose,
  overlayClassName = "modal-backdrop",
  ...contentProps
}: OsDialogProps) {
  const describedBy = contentProps["aria-describedby"];

  return (
    <Dialog.Root
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={overlayClassName}>
          <Dialog.Content aria-describedby={describedBy} className={contentClassName} {...contentProps}>
            {children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const OsDialogClose = Dialog.Close;
export const OsDialogTitle = Dialog.Title;
