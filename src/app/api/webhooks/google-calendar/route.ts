import { NextRequest, NextResponse } from "next/server";

/**
 * Google Calendar Push Notification Webhook Receiver.
 * Receives notifications when calendar events are modified or created in Google Calendar.
 *
 * Headers received from Google:
 * - X-Goog-Channel-ID: UUID string identifying the notification channel
 * - X-Goog-Channel-Token: Optional channel token provided during watch setup
 * - X-Goog-Resource-ID: ID of the watched resource
 * - X-Goog-Resource-URI: URI of the watched resource
 * - X-Goog-Resource-State: State of the resource ("sync", "exists", "not_exists")
 * - X-Goog-Message-Number: Monotonically increasing notification number
 * - X-Goog-Channel-Expiration: Expiration date and time of the channel
 */
export async function POST(req: NextRequest) {
  try {
    const channelId = req.headers.get("x-goog-channel-id");
    const resourceId = req.headers.get("x-goog-resource-id");
    const resourceState = req.headers.get("x-goog-resource-state");
    const resourceUri = req.headers.get("x-goog-resource-uri");
    const messageNumber = req.headers.get("x-goog-message-number");
    const channelToken = req.headers.get("x-goog-channel-token");
    const expiration = req.headers.get("x-goog-channel-expiration");

    // Validate X-Goog-Channel-ID
    if (!channelId || channelId.trim().length === 0) {
      console.warn(
        "[GoogleCalendarWebhook] Rejected push notification: Missing or empty X-Goog-Channel-ID header."
      );
      return NextResponse.json(
        { error: "Invalid notification: Missing X-Goog-Channel-ID header." },
        { status: 400 }
      );
    }

    console.info("[GoogleCalendarWebhook] Notification received:", {
      channelId,
      resourceId,
      resourceState,
      messageNumber,
      expiration,
      hasToken: Boolean(channelToken),
    });

    // Handle handshake / sync notification
    if (resourceState === "sync") {
      console.info(
        `[GoogleCalendarWebhook] Sync handshake acknowledged for channel: ${channelId}`
      );
      return NextResponse.json(
        {
          received: true,
          status: "sync_acknowledged",
          channelId,
        },
        { status: 200 }
      );
    }

    // Handle resource state update (event created, updated, or cancelled in Google Calendar)
    if (resourceState === "exists") {
      console.info(
        `[GoogleCalendarWebhook] Event change detected for channel ${channelId}, resource ${resourceId}. Resource URI: ${resourceUri}`
      );
      // In production with bi-directional syncing, this triggers a delta sync fetch from Google Calendar API.
    }

    return NextResponse.json(
      {
        received: true,
        channelId,
        resourceState: resourceState || "unknown",
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GoogleCalendarWebhook] Error handling webhook push:", message);
    return NextResponse.json(
      { error: "Internal error processing calendar notification." },
      { status: 500 }
    );
  }
}

/**
 * Health check endpoint for verifying webhook availability.
 */
export async function GET() {
  return NextResponse.json(
    {
      service: "ELTs. Studio Google Calendar Webhook",
      status: "active",
      supportedPushStates: ["sync", "exists", "not_exists"],
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
