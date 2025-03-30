const { ApplicationCommandOptionType, EmbedBuilder } = require('discord.js');
const config = require('../config.js');
const musicIcons = require('../UI/icons/musicicons.js');
const SpotifyWebApi = require('spotify-web-api-node');
const { getData } = require('spotify-url-info')(require('node-fetch'));
const requesters = new Map();

const spotifyApi = new SpotifyWebApi({
    clientId: config.spotifyClientId,
    clientSecret: config.spotifyClientSecret,
});

async function getSpotifyPlaylistTracks(playlistId) {
    try {
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body.access_token);

        let tracks = [];
        let offset = 0;
        const limit = 100;
        let total = 0;

        do {
            const response = await spotifyApi.getPlaylistTracks(playlistId, { limit, offset });
            total = response.body.total;
            offset += limit;

            for (const item of response.body.items) {
                if (item.track && item.track.name && item.track.artists) {
                    const trackName = `${item.track.name} - ${item.track.artists.map(a => a.name).join(', ')}`;
                    tracks.push(trackName);
                }
            }
        } while (tracks.length < total && offset < 1000); // Safety limit

        return tracks;
    } catch (error) {
        console.error("Error fetching Spotify playlist tracks:", error);
        return [];
    }
}

async function play(client, interaction, lang) {
    try {
        const query = interaction.options.getString('name');

        // Voice channel check
        if (!interaction.member.voice.channelId) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ff0000')
                        .setAuthor({
                            name: lang.play.embed.error,
                            iconURL: musicIcons.alertIcon,
                            url: config.SupportServer
                        })
                        .setFooter({ text: lang.footer, iconURL: musicIcons.heartIcon })
                        .setDescription(lang.play.embed.noVoiceChannel)
                ],
                ephemeral: true
            });
        }

        // Lavalink node check
        if (!client.riffy.nodes || client.riffy.nodes.size === 0) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ff0000')
                        .setAuthor({
                            name: lang.play.embed.error,
                            iconURL: musicIcons.alertIcon,
                            url: config.SupportServer
                        })
                        .setFooter({ text: lang.footer, iconURL: musicIcons.heartIcon })
                        .setDescription(lang.play.embed.noLavalinkNodes)
                ],
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const player = client.riffy.createConnection({
            guildId: interaction.guildId,
            voiceChannel: interaction.member.voice.channelId,
            textChannel: interaction.channelId,
            deaf: true
        });

        // Spotify handling
        if (query.includes('spotify.com')) {
            try {
                const spotifyData = await getData(query);
                let tracksToQueue = [];

                if (spotifyData.type === 'track') {
                    tracksToQueue.push(`${spotifyData.name} - ${spotifyData.artists.map(a => a.name).join(', ')}`);
                } else if (spotifyData.type === 'playlist') {
                    const playlistId = query.split('/playlist/')[1].split('?')[0];
                    tracksToQueue = await getSpotifyPlaylistTracks(playlistId);
                }

                let queuedCount = 0;
                for (const trackQuery of tracksToQueue) {
                    const resolve = await client.riffy.resolve({ query: trackQuery, requester: interaction.user });
                    if (resolve && resolve.tracks && resolve.tracks.length > 0) {
                        const track = resolve.tracks[0];
                        track.info.requester = interaction.user;
                        player.queue.add(track);
                        requesters.set(track.info.uri, interaction.user.username);
                        queuedCount++;
                    }
                }

                if (queuedCount === 0) {
                    throw new Error('No tracks found from Spotify');
                }

                if (!player.playing && !player.paused) player.play();

                return interaction.followUp({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(config.embedColor)
                            .setAuthor({
                                name: lang.play.embed.requestUpdated,
                                iconURL: musicIcons.beats2Icon,
                                url: config.SupportServer
                            })
                            .setDescription(`Queued ${queuedCount} tracks from Spotify`)
                            .setFooter({ text: lang.footer, iconURL: musicIcons.heartIcon })
                    ]
                });
            } catch (err) {
                console.error('Spotify error:', err);
                return interaction.followUp({
                    content: "❌ Failed to process Spotify link. Please try a different source."
                });
            }
        }

        // Regular query handling
        try {
            const resolve = await client.riffy.resolve({ query, requester: interaction.user });

            // Validate response structure
            if (!resolve || !resolve.tracks || !Array.isArray(resolve.tracks)) {
                throw new Error('Invalid response from Lavalink');
            }

            if (resolve.loadType === 'NO_MATCHES' || resolve.loadType === 'LOAD_FAILED') {
                return interaction.followUp({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(config.embedColor)
                            .setAuthor({
                                name: lang.play.embed.error,
                                iconURL: musicIcons.alertIcon,
                                url: config.SupportServer
                            })
                            .setFooter({ text: lang.footer, iconURL: musicIcons.heartIcon })
                            .setDescription(lang.play.embed.noResults)
                    ]
                });
            }

            // Handle different load types
            if (resolve.loadType === 'PLAYLIST_LOADED') {
                for (const track of resolve.tracks) {
                    track.info.requester = interaction.user;
                    player.queue.add(track);
                    requesters.set(track.info.uri, interaction.user.username);
                }

                if (!player.playing && !player.paused) player.play();

                return interaction.followUp({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(config.embedColor)
                            .setAuthor({
                                name: lang.play.embed.requestUpdated,
                                iconURL: musicIcons.beats2Icon,
                                url: config.SupportServer
                            })
                            .setDescription(`Added ${resolve.tracks.length} tracks from playlist`)
                            .setFooter({ text: lang.footer, iconURL: musicIcons.heartIcon })
                    ]
                });
            }

            // Single track handling
            if (resolve.tracks.length > 0) {
                const track = resolve.tracks[0];
                track.info.requester = interaction.user;
                player.queue.add(track);
                requesters.set(track.info.uri, interaction.user.username);

                if (!player.playing && !player.paused) player.play();

                return interaction.followUp({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(config.embedColor)
                            .setAuthor({
                                name: lang.play.embed.requestUpdated,
                                iconURL: musicIcons.beats2Icon,
                                url: config.SupportServer
                            })
                            .setDescription(`Now playing: [${track.info.title}](${track.info.uri})`)
                            .setFooter({ text: lang.footer, iconURL: musicIcons.heartIcon })
                    ]
                });
            }
        } catch (err) {
            console.error('Lavalink error:', err);
            return interaction.followUp({
                content: "❌ Failed to process your request. Please try a different query."
            });
        }
    } catch (error) {
        console.error('Play command error:', error);
        await interaction.followUp({
            content: "❌ An unexpected error occurred. Please try again."
        });
    }
}

module.exports = {
    name: "play",
    description: "Play a song from a name or link",
    permissions: "0x0000000000000800",
    options: [{
        name: 'name',
        description: 'Enter song name/link or playlist',
        type: ApplicationCommandOptionType.String,
        required: true
    }],
    run: play,
    requesters: requesters,
};
