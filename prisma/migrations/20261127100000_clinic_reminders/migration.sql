-- WhatsApp appointment reminders: when the desk sent one, and the owner's own wording.
ALTER TABLE "ClBooking" ADD COLUMN "remindedAt" TIMESTAMP(3);
ALTER TABLE "ClSettings" ADD COLUMN "reminderText" TEXT;
