<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** A link to the web client's reset form (`/?reset=<token>&email=<email>`). */
class ResetPasswordLink extends Notification
{
    public function __construct(public readonly string $token) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function url(object $notifiable): string
    {
        return rtrim((string) config('platform.auth.client_url'), '/').'/?'.http_build_query([
            'reset' => $this->token,
            'email' => $notifiable->getEmailForPasswordReset(),
        ]);
    }

    public function toMail(object $notifiable): MailMessage
    {
        $minutes = (int) config('auth.passwords.users.expire');

        return (new MailMessage)
            ->subject('Reset your password')
            ->line('Someone (hopefully you) asked to reset the password of '.$notifiable->username.'.')
            ->action('Choose a new password', $this->url($notifiable))
            ->line("The link works for {$minutes} minutes. If you did not ask for it, ignore this email: nothing changes.");
    }
}
