local spawned = false

AddEventHandler('playerSpawned', function()
    if spawned then return end
    spawned = true
    TriggerServerEvent('xionshield-bot:spawned')
end)

RegisterNetEvent('xionshield-bot:revive', function()
    local ped = PlayerPedId()
    local coords = GetEntityCoords(ped)
    NetworkResurrectLocalPlayer(coords.x, coords.y, coords.z, GetEntityHeading(ped), 0, false)
    ped = PlayerPedId()
    SetEntityHealth(ped, GetEntityMaxHealth(ped))
    ClearPedBloodDamage(ped)
    ClearPedTasksImmediately(ped)
end)
