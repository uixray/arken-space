import { appToaster } from "./toaster";

export type NotificationTone = "success" | "danger" | "warning" | "info";

export interface NotificationInput {
  title: string;
  message?: string;
  tone?: NotificationTone;
  autoHiding?: number | false;
}

let notificationSequence = 0;

export function notify({
  title,
  message,
  tone = "info",
  autoHiding = 5000,
}: NotificationInput) {
  notificationSequence += 1;
  const name = `arken-notification-${notificationSequence}`;

  appToaster.add({
    name,
    title,
    content: message,
    theme: tone,
    autoHiding,
    isClosable: true,
  });

  return name;
}
